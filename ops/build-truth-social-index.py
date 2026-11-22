"""Merge downloaded CNN JSON and Trump's Truth archive JSONL.gz into a public link index."""
import argparse
import base64
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import gzip
import json
from pathlib import Path
import re


def account_post(url, post_id):
    return isinstance(post_id, str) and re.fullmatch(r"[0-9]{15,20}", post_id) and url == (
        "https://truthsocial.com/@realDonaldTrump/" + post_id
    )


def timestamp(value):
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None:
        raise ValueError(f"Missing time zone: {value}")
    return int(date.timestamp())


def read_cnn(path):
    with path.open(encoding="utf-8") as stream:
        return {
            row["id"]: (timestamp(row["created_at"]), bool(row.get("media")))
            for row in json.load(stream)
            if account_post(row.get("url"), row.get("id"))
        }


def read_trumps_truth(path):
    result = {}
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            post_id = row.get("truth_id")
            if account_post(row.get("truth_url"), post_id):
                kind = {"original": "p", "quote": "q", "reblog": "r"}.get(row.get("post_type"), "u")
                archive_id = str(row.get("trumpstruth_id") or "")
                if row.get("source_url") != "https://trumpstruth.org/statuses/" + archive_id or not archive_id.isdecimal():
                    archive_id = ""
                result[post_id] = (timestamp(row["created_at_utc"]), kind, bool(row.get("attachments") or row.get("media_urls")), archive_id)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cnn", type=Path)
    parser.add_argument("trumps_truth", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    cnn, trumps_truth = read_cnn(args.cnn), read_trumps_truth(args.trumps_truth)
    if not cnn or not trumps_truth:
        raise ValueError("Both archive sources must contain valid posts")

    korea = timezone(timedelta(hours=9))
    years = defaultdict(list)
    for post_id in cnn.keys() | trumps_truth.keys():
        archive_time, kind, archive_media, archive_id = trumps_truth.get(post_id, (0, "u", False, ""))
        created_at, cnn_media = cnn.get(post_id, (archive_time, False))
        date = datetime.fromtimestamp(created_at, korea)
        years[date.year].append([post_id, created_at, kind, int(cnn_media or archive_media), archive_id])

    args.output.mkdir(parents=True, exist_ok=True)
    manifest = []
    for year, rows in sorted(years.items(), reverse=True):
        rows.sort(key=lambda row: (row[1], row[0]), reverse=True)
        data = json.dumps(rows, separators=(",", ":")).encode()
        encoded = base64.b64encode(gzip.compress(data, mtime=0)).decode("ascii")
        (args.output / f"{year}.txt").write_text(encoded + "\n", encoding="ascii")
        manifest.append(dict(
            year=year, count=len(rows),
            first=datetime.fromtimestamp(rows[-1][1], korea).date().isoformat(),
            last=datetime.fromtimestamp(rows[0][1], korea).date().isoformat(),
        ))
    print(json.dumps(manifest, separators=(",", ":")))


if __name__ == "__main__":
    main()
