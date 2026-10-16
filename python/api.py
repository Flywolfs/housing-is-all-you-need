# -*- coding: utf-8 -*-
"""
买房 vs 租房 对比 API（标准库实现，无第三方依赖）

输入 8 个参数，其余参数按三级优先级取值：
  请求显式参数 > params 参数文件（UI 导出）> hk_engine.DEFAULT_INPUTS 引擎默认
  price        当前单位售价（必填，$）
  rent         当前单位租价（必填，$/月）→ 出租收入 rental_income_monthly_0；
               租房方案自住租金 rent1_monthly 取同值（租的就是这个房子）
  years        模拟时长（默认 20，1-30）
  down_payment 首付比例 %（默认 30）
  loan_years   贷款年限（默认 30）
  switch       是否中途换房（默认 False；True = 第 N 年起出租小房+租大房）
  switch_year  换房第几年（默认 6，switch=True 时生效）
  mgmt_fee     管理费 $/月（默认 1500）
可选覆盖（屋苑扫描脚本用）：rent2（大房租金，默认 18000）

参数文件：UI「导出参数 JSON」生成（camelCase Inputs），api.py 读取后转 snake_case
作为默认层——跑真实屋苑时直接用自己配置好的利率、回赠、收入等参数。

用法：
  CLI:   python3 api.py simulate --price 5000000 --rent 13500 [--params my.json ...]
  HTTP:  python3 api.py serve [--port 8787] [--params my.json]
         POST /simulate  body: {"price": 5000000, "rent": 13500, ...}
         GET  /health    → {"status": "ok"}
"""
import argparse
import json
import re
import sys
from dataclasses import fields
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from hk_engine import Inputs, MAX_YEARS, simulate

DEFAULTS_DOC = {
    "years": 20,
    "down_payment_pct": 30,
    "loan_years": 30,
    "switch": False,
    "switch_year": 6,
    "mgmt_fee_monthly": 1500,
    "rent2_monthly": 18000,
}

# 请求层（API 键名）接管的字段——params 文件中的同义字段不直接进引擎
REQUEST_OVERRIDABLE = {
    "years", "down_payment_pct", "loan_years", "rent_out_enabled", "switch_year",
    "mgmt_fee_monthly", "rent2_monthly", "property_price", "rent1_monthly", "rental_income_monthly_0",
}

_SERVE_PARAMS: dict = {}  # serve 模式的全局参数文件层


def _camel_to_snake(name: str) -> str:
    return re.sub(r"([A-Z]+)", lambda m: "_" + m.group(1).lower(), name)


def load_params(path: str) -> tuple[dict, list]:
    """读取 UI 导出的参数 JSON → (snake_case 参数 dict, 警告列表)。
    兼容 {metadata, params} 包装格式与裸 Inputs 对象；未知字段忽略并警告。"""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    raw = data.get("params") if isinstance(data, dict) and isinstance(data.get("params"), dict) else data
    if not isinstance(raw, dict):
        raise ValueError(f"参数文件格式错误（应为 UI 导出的参数 JSON）: {path}")
    valid = {f.name for f in fields(Inputs)}
    out, warnings = {}, []
    for k, v in raw.items():
        sk = _camel_to_snake(k)
        if sk not in valid:
            warnings.append(f"参数文件忽略未知字段: {k}")
            continue
        out[sk] = v
    return out, warnings


def build_inputs(spec: dict, params: dict | None = None) -> tuple[Inputs, list]:
    """API 参数 → (引擎 Inputs, API 层警告)。校验失败抛 ValueError。
    优先级：spec（请求显式）> params（UI 导出参数文件）> 引擎内置默认。"""
    p = params or {}

    def req_float(key):
        v = spec.get(key)
        if v is None:
            raise ValueError(f"缺少必填参数: {key}")
        try:
            f = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"参数 {key} 必须是数字，收到: {v!r}")
        return f

    price = req_float("price")
    rent = req_float("rent")
    if price <= 0:
        raise ValueError("price 必须 > 0")
    if rent < 0:
        raise ValueError("rent 不能为负")

    # 参数层级：spec > params（引擎字段名）> 内置默认
    years = int(spec.get("years", p.get("years", 20)))
    down = float(spec.get("down_payment", p.get("down_payment_pct", 30)))
    loan_years = int(spec.get("loan_years", p.get("loan_years", 30)))
    switch = bool(spec.get("switch", p.get("rent_out_enabled", False)))
    switch_year = int(spec.get("switch_year", p.get("switch_year", 6)))
    mgmt = float(spec.get("mgmt_fee", p.get("mgmt_fee_monthly", 1500)))
    rent2 = float(spec.get("rent2", p.get("rent2_monthly", 18_000)))

    if not (1 <= years <= MAX_YEARS):
        raise ValueError(f"years 必须在 1-{MAX_YEARS} 之间")
    if not (0 < down <= 100):
        raise ValueError("down_payment 必须在 (0, 100]")
    if loan_years < 1:
        raise ValueError("loan_years 必须 >= 1")
    if switch and switch_year < 1:
        raise ValueError("switch=True 时 switch_year 必须 >= 1")
    if mgmt < 0 or rent2 < 0:
        raise ValueError("mgmt_fee / rent2 不能为负")

    warnings = []
    if switch and switch_year > years:
        warnings.append(f"换房第 {switch_year} 年超过模拟时长 {years} 年，全程不会触发换房")

    # params 中非请求接管的字段（利率、回赠、装修、收入等）作为引擎默认层
    # （cash_follow_upfront 单独处理：允许 params 关闭纯粹对比口径，未提供时默认开）
    engine_kwargs = {k: v for k, v in p.items() if k not in REQUEST_OVERRIDABLE and k != "cash_follow_upfront"}
    inp = Inputs(
        **engine_kwargs,
        years=years,
        property_price=price,
        rental_income_monthly_0=rent,   # 买了之后出租：市场租金收入
        rent1_monthly=rent,             # 不买直接租这个房子：同一市场租价
        rent2_monthly=rent2,            # 换大房租金
        down_payment_pct=down,
        loan_years=loan_years,
        rent_out_enabled=switch,        # 换大房 = 小房出租（用户确认联动）
        switch_year=switch_year if switch else 0,
        mgmt_fee_monthly=mgmt,
        cash_follow_upfront=p.get("cash_follow_upfront", True),  # 默认纯粹对比口径
    )
    return inp, warnings


def run_simulate(spec: dict, params: dict | None = None) -> dict:
    """执行模拟并输出 API JSON 响应。"""
    inp, api_warnings = build_inputs(spec, params)
    r = simulate(inp)
    d = r.derived
    return {
        "years": inp.years,
        "price": inp.property_price,
        "rent": inp.rent1_monthly,
        "switch": inp.rent_out_enabled,
        "switch_year": inp.switch_year,
        "buy_net_worth": round(d.final_buy, 2),
        "rent_net_worth": round(d.final_rent, 2),
        "diff": round(d.final_diff, 2),  # 买房 − 租房，正 = 买房更优
        "break_even_year": d.break_even_year,
        "loan_amount": round(d.loan_amount, 2),
        "ltv_pct": round(d.ltv_pct, 2),
        "monthly_payment": round(d.monthly_payment_0, 2),
        "dsr_pct": round(d.dsr_pct, 2),
        "upfront_buy": round(d.upfront_buy, 2),
        "stamp_duty": round(d.stamp_duty, 2),
        "mip_premium": round(d.mip_premium, 2) if d.mip_eligible else None,
        "warnings": api_warnings + r.warnings,
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok", "params_loaded": bool(_SERVE_PARAMS)})
        else:
            self._send(404, {"error": "not found, use POST /simulate"})

    def do_POST(self):
        if self.path != "/simulate":
            self._send(404, {"error": "not found, use POST /simulate"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            spec = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as e:
            self._send(400, {"error": f"JSON 解析失败: {e}"})
            return
        try:
            self._send(200, run_simulate(spec, _SERVE_PARAMS or None))
        except ValueError as e:
            self._send(400, {"error": str(e)})

    def log_message(self, fmt, *args):
        sys.stderr.write("[api] %s\n" % (fmt % args))


def main():
    p = argparse.ArgumentParser(description="买房 vs 租房 对比 API")
    p.add_argument("--params", default=None, help="UI 导出的参数 JSON（作为默认参数层）")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("simulate", help="单次模拟，输出 JSON")
    s.add_argument("--price", type=float, required=True, help="当前单位售价 $")
    s.add_argument("--rent", type=float, required=True, help="当前单位租价 $/月")
    # 以下参数默认 None：不传时走 params 参数文件 / 引擎内置默认（请求显式参数 > params > 内置）
    s.add_argument("--years", type=int, default=None, help="模拟时长 1-30（默认取参数文件/20）")
    s.add_argument("--down-payment", type=float, default=None, help="首付比例 %%（默认取参数文件/30）")
    s.add_argument("--loan-years", type=int, default=None, help="贷款年限（默认取参数文件/30）")
    s.add_argument("--switch", action=argparse.BooleanOptionalAction, default=None,
                   help="开启中途换房（--switch 开 / --no-switch 关；默认取参数文件/关）")
    s.add_argument("--switch-year", type=int, default=None, help="换房第几年（默认取参数文件/6）")
    s.add_argument("--mgmt-fee", type=float, default=None, help="管理费 $/月（默认取参数文件/1500；扫描脚本按楼龄生成）")
    s.add_argument("--rent2", type=float, default=None, help="大房租金 $/月（默认取参数文件/18000）")

    v = sub.add_parser("serve", help="启动 HTTP 服务")
    v.add_argument("--port", type=int, default=8787)
    v.add_argument("--host", default="127.0.0.1")

    args = p.parse_args()

    global _SERVE_PARAMS
    params, param_warnings = ({}, [])
    if args.params:
        params, param_warnings = load_params(args.params)
        for w in param_warnings:
            sys.stderr.write(f"[api] 参数文件警告: {w}\n")
        # 提示走 stderr，保持 simulate 的 stdout 为纯 JSON
        print(f"已加载参数文件: {args.params}（{len(params)} 个字段）", file=sys.stderr)
    if args.cmd == "simulate":
        spec = {
            "price": args.price,
            "rent": args.rent,
            "years": args.years,
            "down_payment": args.down_payment,
            "loan_years": args.loan_years,
            "switch": args.switch,
            "switch_year": args.switch_year,
            "mgmt_fee": args.mgmt_fee,
            "rent2": args.rent2,
        }
        spec = {k: v for k, v in spec.items() if v is not None}  # 未显式传的走 params/内置默认
        print(json.dumps(run_simulate(spec, params), ensure_ascii=False, indent=2))
    else:
        _SERVE_PARAMS = params
        server = ThreadingHTTPServer((args.host, args.port), Handler)
        print(f"API 已启动: http://{args.host}:{args.port}  (POST /simulate)")
        server.serve_forever()


if __name__ == "__main__":
    main()
