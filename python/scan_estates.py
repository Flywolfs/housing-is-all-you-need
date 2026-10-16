#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
屋苑买租扫描脚本：遍历全港屋苑的真实租售成交数据，逐户型调用买租对比 API，
输出各屋苑各户型的买租资产差（example.json 格式）。

数据源（每个文件一个屋苑，文件名 = 屋苑id）：
  buy/  售数据：date 成交日期、total_price 售价、area 面积（呎）
  rent/ 租数据：同字段，total_price 为租价

处理逻辑（借鉴 calculate_rent_sale_ratio.py）：
  1. 时间过滤：只取 [min_date, max_date] 内的成交记录
  2. 面积聚类：同屋苑内 buy+rent 记录合并，按面积 8% 容差贪心聚类
  3. IQR 剔除异常值（记录数 < 4 不剔除），取均值作为该户型的售价/租金
  4. 管理费：按屋苑楼龄，每呎 5 元起步、每 5 年减 0.5 元、最低 1 元；
     月管理费 = 单价 × 面积（establish_year 缺失按 3.0 元/呎）
  5. 逐户型调用 api.run_simulate，score = 买房 − 租房期末净资产差
  6. verdict：score > 0 → buy；屋苑内任一户型 buy → 屋苑 buy

用法：
  python3 scan_estates.py                     # 默认参数全量扫描
  python3 scan_estates.py --years 20 --switch --switch-year 6
"""
import argparse
import json
import logging
import math
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from api import load_params, run_simulate

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("scan")

DEFAULT_DATA_DIR = "/home/zhangchi/Documents/28hse/centanet_system/crawler/transaction_record_20261003_trans"
DEFAULT_ESTATE_INFO = "/home/zhangchi/Documents/28hse/centanet_system/crawler/estate_info_20260221_convert.json"
DEFAULT_OUTPUT = "/home/zhangchi/Documents/hk_realestate_value/python/example.json"

AREA_THRESHOLD = 0.08  # 面积聚类容差 8%（同参考脚本）


# ============================================================
# 异常值剔除（IQR，与 calculate_rent_sale_ratio.remove_outliers_iqr 一致）
# ============================================================
def _percentile(sorted_vals, q):
    """纯 Python 实现 np.percentile 的线性插值口径"""
    n = len(sorted_vals)
    if n == 1:
        return sorted_vals[0]
    idx = (n - 1) * q / 100
    lo, hi = math.floor(idx), math.ceil(idx)
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)


def remove_outliers_iqr(values):
    if len(values) < 4:  # 数据量太少不剔除（同参考脚本）
        return list(values)
    s = sorted(values)
    q1, q3 = _percentile(s, 25), _percentile(s, 75)
    iqr = q3 - q1
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    return [x for x in s if lo <= x <= hi]


# ============================================================
# 面积聚类：同屋苑 buy+rent 记录合并，8% 容差贪心聚类
# ============================================================
def _parse_date(s):
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except (TypeError, ValueError):
        return None


def cluster_transactions(buy_trans, rent_trans, min_date, max_date):
    """返回聚类列表 [{areas, buys, rents}]，buys/rens 为售价/租金金额列表"""
    clusters = []
    for kind, transactions in (("buys", buy_trans), ("rents", rent_trans)):
        for t in transactions or []:
            d = _parse_date(t.get("date"))
            if d is None:  # 日期无效无法定位时间段，跳过
                continue
            if (min_date and d < min_date) or (max_date and d > max_date):
                continue
            try:
                area = float(t.get("area", 0))
                price = float(t.get("total_price", 0))
            except (TypeError, ValueError):
                continue
            if area <= 0 or price <= 0:
                continue
            matched = None
            for c in clusters:
                avg = sum(c["areas"]) / len(c["areas"])
                if abs(area - avg) / avg < AREA_THRESHOLD:
                    matched = c
                    break
            if matched is None:
                matched = {"areas": [], "buys": [], "rents": []}
                clusters.append(matched)
            matched["areas"].append(area)
            matched[kind].append(price)
    return clusters


# ============================================================
# 管理费：楼龄 → 每呎月管理费（5 元起步，每 5 年减 0.5，最低 1 元）
# ============================================================
def mgmt_fee_rate(age):
    if age < 0:
        age = 0
    steps = max(0, (age - 1) // 5)  # age≤5 → 0 档 5.0 元；6-10 → 4.5；以此类推
    return max(1.0, 5.0 - 0.5 * steps)


# ============================================================
# 单屋苑扫描
# ============================================================
def scan_estate(buy_trans, rent_trans, fee_rate, sim_params, min_date, max_date, params=None):
    """返回 details 列表（按面积升序）"""
    details = []
    for c in cluster_transactions(buy_trans, rent_trans, min_date, max_date):
        buys = remove_outliers_iqr(c["buys"])
        rents = remove_outliers_iqr(c["rents"])
        if not buys or not rents:  # 该面积段缺买或租数据，跳过
            continue
        sale_price = round(sum(buys) / len(buys))
        monthly_rent = round(sum(rents) / len(rents))
        area_avg = sum(c["areas"]) / len(c["areas"])
        out = run_simulate({
            "price": sale_price,
            "rent": monthly_rent,
            "mgmt_fee": fee_rate * area_avg,
            **sim_params,
        }, params)
        score = out["diff"]
        details.append({
            "area": int(round(area_avg)),
            "monthly_rent": monthly_rent,
            "sale_price": sale_price,
            "score": round(score, 2),
            "verdict": "buy" if score > 0 else "rent",
        })
    details.sort(key=lambda d: d["area"])
    return details


# ============================================================
# 主流程
# ============================================================
def main():
    p = argparse.ArgumentParser(description="屋苑买租扫描脚本")
    p.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    p.add_argument("--estate-info", default=DEFAULT_ESTATE_INFO)
    p.add_argument("--output", default=DEFAULT_OUTPUT)
    p.add_argument("--min-date", default="2025-01-01", help="只统计该日期后成交（默认 2025-01-01）")
    p.add_argument("--max-date", default=None, help="只统计该日期前成交（默认不限）")
    p.add_argument("--params", default=None, help="UI 导出的参数 JSON（利率/回赠/收入等作为默认参数层）")
    # API 层参数默认 None：不传时走 params 文件 / 内置默认（请求显式 > params > 内置）
    p.add_argument("--years", type=int, default=None)
    p.add_argument("--down-payment", type=float, default=None)
    p.add_argument("--loan-years", type=int, default=None)
    p.add_argument("--switch", action=argparse.BooleanOptionalAction, default=None,
                   help="中途换房（--switch 开 / --no-switch 关；默认取参数文件/关）")
    p.add_argument("--switch-year", type=int, default=None)
    args = p.parse_args()

    params, param_warnings = ({}, [])
    if args.params:
        params, param_warnings = load_params(args.params)
        for w in param_warnings:
            logger.warning("参数文件%s", w)
        logger.info("已加载参数文件: %s（%d 个字段）", args.params, len(params))

    min_date = datetime.strptime(args.min_date, "%Y-%m-%d") if args.min_date else None
    max_date = datetime.strptime(args.max_date, "%Y-%m-%d") if args.max_date else None
    sim_params = {
        k: v
        for k, v in {
            "years": args.years,
            "down_payment": args.down_payment,
            "loan_years": args.loan_years,
            "switch": args.switch,
            "switch_year": args.switch_year,
        }.items()
        if v is not None
    }
    # 记录实际生效的口径（CLI 显式 > params 文件 > 内置默认）
    eff_params = {
        "years": sim_params.get("years", params.get("years", 20)),
        "down-payment": sim_params.get("down_payment", params.get("down_payment_pct", 30)),
        "loan-years": sim_params.get("loan_years", params.get("loan_years", 30)),
        "switch": sim_params.get("switch", params.get("rent_out_enabled", False)),
        "switch-year": sim_params.get("switch_year", params.get("switch_year", 6)),
    }

    # 屋苑信息：id → name / establish_year
    with open(args.estate_info, encoding="utf-8") as f:
        estate_info = json.load(f)
    logger.info("屋苑信息已加载: %d 个", len(estate_info))

    # buy ∩ rent 的屋苑 id
    buy_dir, rent_dir = Path(args.data_dir) / "buy", Path(args.data_dir) / "rent"
    buy_ids = {f.stem for f in buy_dir.glob("*.json")}
    rent_ids = {f.stem for f in rent_dir.glob("*.json")}
    common_ids = sorted(buy_ids & rent_ids)
    logger.info("buy 文件 %d 个，rent 文件 %d 个，两厢齐全 %d 个", len(buy_ids), len(rent_ids), len(common_ids))

    today_year = datetime.now().year
    data = {}
    no_info_count, no_establish_year_count = 0, 0

    for i, eid in enumerate(common_ids, 1):
        if i % 200 == 0:
            logger.info("进度 %d/%d（已输出 %d 屋苑）", i, len(common_ids), len(data))
        info = estate_info.get(eid)
        if info is None:
            no_info_count += 1
        establish_year = (info or {}).get("basic_info", {}).get("establish_year")
        if isinstance(establish_year, int) and establish_year > 1900:
            fee_rate = mgmt_fee_rate(today_year - establish_year)
        else:
            fee_rate = 3.0  # establish_year 缺失按 3.0 元/呎
            no_establish_year_count += 1

        try:
            with open(buy_dir / f"{eid}.json", encoding="utf-8") as f:
                buy_trans = json.load(f).get("transactions", [])
            with open(rent_dir / f"{eid}.json", encoding="utf-8") as f:
                rent_trans = json.load(f).get("transactions", [])
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("跳过 %s: 读文件失败 %s", eid, e)
            continue

        details = scan_estate(buy_trans, rent_trans, fee_rate, sim_params, min_date, max_date, params)
        if not details:
            continue  # 无任何同时具备买+租数据的户型
        data[eid] = {
            "name": (info or {}).get("name") or eid,
            "verdict": "buy" if any(d["verdict"] == "buy" for d in details) else "rent",
            "details": details,
        }

    output = {
        "metadata": {
            "description": "买租划算度评估结果",
            "generated_at": datetime.now().strftime("%Y-%m-%d"),
            "source": "买租对比API（基于 transaction_record_20261003_trans 买卖+出租数据）",
            "input_params": eff_params,
            "params_file": args.params,
            "time_range": f"{args.min_date or '最早'} ~ {args.max_date or '最新'}",
            "total_estates": len(data),
            "stats": {
                "common_estates": len(common_ids),
                "estates_without_info": no_info_count,
                "estates_without_establish_year": no_establish_year_count,
                "total_details": sum(len(v["details"]) for v in data.values()),
                "buy_verdict_estates": sum(1 for v in data.values() if v["verdict"] == "buy"),
            },
        },
        "data": data,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    s = output["metadata"]["stats"]
    logger.info(
        "完成: 输出 %d 屋苑 / %d 户型 → %s；buy 屋苑 %d 个；无屋苑信息 %d 个、无楼龄 %d 个",
        output["metadata"]["total_estates"], s["total_details"], args.output,
        s["buy_verdict_estates"], s["estates_without_info"], s["estates_without_establish_year"],
    )


if __name__ == "__main__":
    main()
