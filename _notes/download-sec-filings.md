---
title: "Bulk-Downloading SEC Filings (10-K, 10-Q, 8-K) with Python for Free: A Practical and Robust Approach"
date: 2026-03-07
last_updated: March 2026
description: "A version-proof pipeline for bulk-downloading EDGAR filings using WRDS metadata and plain HTTP requests."
tags: [Python, SEC EDGAR, WRDS, Data]
---

In this note, I explain how to download SEC filings using Python (Jupyter Notebook), especially Forms 10-K, 10-Q, and 8-K, along with their amendment variants (\*/A), without paying for any third-party API. I felt the need for a more robust approach because many widely used Python libraries for SEC downloads evolve quickly and often introduce breaking changes in their syntax and workflows. I have used a few of these packages, and I found that older tutorials or previously working scripts frequently stop matching the latest versions, which makes it harder to reuse code and to reproduce the same download pipeline over time. Even when the libraries are free, they still depend on live network requests to SEC endpoints, so downloads can be disrupted by transient connection issues, timeouts, rate limiting, or occasional blocking. In my experience, I almost always observed a non-trivial number of failed requests, often on the order of 10 to 20 filings per year, especially when the sample is large.

The approach described in this note reduces these problems by relying on a stable EDGAR archive URL construction rather than package-specific abstractions that may change. Once the filing metadata and the EDGAR file path (`fname`) are obtained from WRDS, each filing maps to **a deterministic archive URL under `https://www.sec.gov/Archives/`**, which makes the download step transparent and easy to debug. Moreover, because the procedure explicitly handles file naming, existence checks, rate limiting, and metadata logging, any failures become easy to identify and re-run without repeating the entire process. The result is a workflow that is less sensitive to library version changes and more reliable to reproduce across time, while still respecting SEC access constraints.

The approach I cover rely on resources one can access if they have a **[WRDS](https://wrds-www.wharton.upenn.edu/)** and **[SEC EDGAR](https://www.sec.gov/edgar/search/)** (which one can create for free via [Login.gov](https://login.gov)). Since you’ve landed on this page, you likely already have a sense of what SEC filings are. Still, giving the benefit of the doubt that a reader may have zero idea about SEC filings and to make this note self contained and consummated, I will explain them in three sentences. (Feel free to skip the next paragraph if you are already familiar!)

> "SEC filings are standardized disclosures that public companies submit to the U.S. Securities and Exchange Commission, containing detailed information about their financial performance, business risks, governance, and major corporate events. Their main usefulness is the enriched narrative text, which can be quantified into variables for studying behavior, sentiment, perceived risk, and risk taking attitudes. The wide use of LLMs engenders a huge reduction in the earlier discountenance about lack of usable text data, because these disclosures can now be processed at scale."

In the beginning, please install the following standard and essential libraries:

```python
from pathlib import Path
import pandas as pd
import re
import os
import requests
from time import sleep
import wrds
from collections import defaultdict
from tqdm.auto import tqdm
```

In the next step, connect WRDS (replace `"username"` with your WRDS username) and SEC EDGAR (change `"user_email"` with your SEC registered email address):

```python
# Connect to WRDS
db = wrds.Connection(wrds_username="username")

# Connect to SEC EDGAR
HEADERS = {"User-Agent": "user_email"}
session = requests.Session()
```

Try an example query:

```python
query = """
SELECT *
FROM wrdssec.wrds_forms
WHERE (form = '10-K' or form = '10-K/A')
AND fdate BETWEEN '2025-01-01' AND '2025-12-31'
"""

df_head = db.raw_sql(query)
print(df_head.form.value_counts())
print(f"cik: {df_head.cik.unique().size}")
```

## The Idea

Before presenting the raw code, I would like to discuss the idea and workflow behind this approach. In most APIs and Python libraries, the download process is anchored on the firm’s CIK (Central Index Key). To retrieve a specific filing from SEC EDGAR, we typically need the CIK (and the filing’s accession-related identifier), because SEC stores filings in the EDGAR Archives under stable, company-specific paths.

Here is an example URL to inspect:

<https://www.sec.gov/Archives/edgar/data/715446/0001493152-25-001787.txt>

If you open this link, it takes you to the SEC EDGAR Archive, where you can access the 10-K filing of Anixa Biosciences, Inc. for FY 2025. A nice attribute of this particular filing is that it is available as a TXT file, and its contents are laid out in an XBRL-like format, which is relatively more structured than what you often get from some API-based downloads.

An important observation is that the prefix of the URL is always the same for 10-K, 10-Q, and 8-K filings:

```text
https://www.sec.gov/Archives/edgar/data/
```

So, the only part we need to construct is the remaining portion of the path, namely the filing-specific identifier. Once we have that identifier, we have a stable and consistent stream of URLs that our program can use to download filings in TXT format.

This is where **WRDS** becomes handy. WRDS stores SEC filing information in a table called `wrdssec.wrds_forms`. In that table, the column `fname` contains exactly the filing-specific path component, for example:

```text
edgar/data/715446/0001493152-25-001787.txt
```

Ahha, Bingo! If we simply combine the base archive prefix, `"https://www.sec.gov/Archives/"` with the `fname` field from **WRDS**, we obtain the **full EDGAR archive URL**. Then we can loop over our desired firms using CIK, filing date (`fdate`) or reporting date (`rdate`), and `fname`, and feed these stable URLs into the program (given below) to download SEC filings as TXT files in a consistent format, without broken links or corrupted outputs. See the example below:

| cik | accession | form | fdate | rdate | secadate | secpdate | coname | fname | wrdsfname |
|---|---|---|---|---|---|---|---|---|---|
| 0000715446 | 0001493152-25-001787 | 10-K | 2025-01-10 | 2024-10-31 | 2025-01-10 | 2025-01-10 | Anixa Biosciences Inc | edgar/data/715446/0001493152-25-001787.txt | 000071/715446/0001493152-25-001787.txt |
| 0001898766 | 0001493152-25-002760 | 10-K | 2025-01-17 | 2024-10-31 | 2025-01-17 | 2025-01-17 | Trio Petroleum Corp. | edgar/data/1898766/0001493152-25-002760.txt | 000189/1898766/0001493152-25-002760.txt |
| 0000109177 | 0000109177-25-000003 | 10-K/A | 2025-01-27 | 2024-09-30 | 2025-01-27 | 2025-01-27 | Spectrum Brands Holdings, Inc. | edgar/data/109177/0000109177-25-000003.txt | 000010/109177/0000109177-25-000003.txt |
| 0001648087 | 0001493152-25-004183 | 10-K/A | 2025-01-29 | 2023-12-31 | 2025-01-29 | 2025-01-29 | AMERICAN REBEL HOLDINGS INC | edgar/data/1648087/0001493152-25-004183.txt | 000164/1648087/0001493152-25-004183.txt |
| 0001318605 | 0001628280-25-003063 | 10-K | 2025-01-30 | 2024-12-31 | 2025-01-29 | 2025-01-30 | Tesla, Inc. | edgar/data/1318605/0001628280-25-003063.txt | 000131/1318605/0001628280-25-003063.txt |
{: .table-wide }

## Python Codes

Before downloading any filings, we first need a clean list of firms and their identifiers. For this demonstration, I start from **WRDS Compustat North America Fundamentals Quarterly**, specifically the table `comp_na_daily_all.fundq`, and pull a cross-section of U.S. firms with usable identifiers.

Concretely, the query keeps only observations with `fic = 'USA'` (U.S. firms), `consol = 'C'` (consolidated statements), `indfmt = 'INDL'` (industrial format), and `datafmt = 'STD'` (standard format). I also restrict the sample to observations with **non-missing total assets** (`atq IS NOT NULL`) and require that **at least one identifier is present** (`cik` or `tic`). Finally, I apply a date window using `datadate` between 2023-01-01 and 2025-12-31. *One important clarification is that `datadate` in Compustat refers to the the fiscal period end date of that quarterly record, not the SEC filing date itself.* If the goal is explicitly “10-K filings submitted between January 1 and January 31, 2025,” that filter should be done on an SEC filings table that has a filing date field (for example, the WRDS SEC forms table I mentioned earlier, using `fdate`). My promise is to demonstrate this later on.

```python
# CIK List from COMPUSTAT (WRDS)
query = """
SELECT DISTINCT
    cik,
    gvkey,
    fic,
    tic,
    atq
FROM comp_na_daily_all.fundq
WHERE fic = 'USA'
  AND consol = 'C'
  AND indfmt = 'INDL'
  AND datafmt = 'STD'
  AND datadate >= '2023-01-01' AND datadate <= '2025-12-31'
  AND (cik IS NOT NULL OR tic IS NOT NULL)
  AND atq IS NOT NULL
"""

compustat_df = db.raw_sql(query)
```

Next, I normalize CIKs using a small helper function that converts them into 10-digit, zero-padded strings, because CIKs can appear with missing leading zeros or come in as floats/strings with extra characters, and padding ensures a consistent, safe identifier for downstream merges and URL construction. I store the padded CIKs in `ciks_10` variable. After that, I simply print a short summary (row count and a few example CIKs) to confirm the extraction worked as expected.

```python
### CIK NORMALIZATION HELPER
def cik10(x):
    """Normalizes CIK to a 10-digit zero-padded string."""
    if pd.isna(x) or x is None:
        return None
    s = str(x).strip()
    s = s.replace(".0", "")  # Remove float artifacts
    s = re.sub(r"\D", "", s) # Remove any non-numeric characters
    if not s:
        return None
    return s.zfill(10)

### APPLY NORMALIZATION AND STORE
# Identify the CIK column (Compustat returns lowercase 'cik' usually)
cik_col = 'cik'

# Create the list of clean, 10-digit CIKs
ciks_10 = (
    compustat_df[cik_col]
    .map(cik10)
    .dropna()
    .drop_duplicates()
    .tolist()
)

print(f"Query returned {len(compustat_df)} rows.")
print(f"Using CIK column: {cik_col}")
print(f"Unique 10-digit CIKs: {len(ciks_10)}")
print("Example CIKs:", ciks_10[:10])
```

Now that I have a cleaned list of CIKs from Compustat, the next step is to feed those CIKs into the WRDS SEC datasets so we can identify the actual filing records and, most importantly, the EDGAR file paths needed to construct stable archive URLs.

Compustat helps us define the firm universe and provides identifiers, but it does not store the EDGAR archive path. For that, we use WRDS’s filing-level table `wrdssec.wrds_forms`, which contains the metadata for each SEC submission, such as the form type, company name, accession number, filing date, and the key field `fname` that stores the trailing EDGAR path (the part that comes after `https://www.sec.gov/Archives/`). This is precisely what we need to generate the complete download URL later.

Now, let's say we only want to download the filings of our previously selected firms for those who has filed their SEC filings in 2025 regardless of their fiscal year (2023, 2024 and 2025) and to do this, I will use `fdate` (promise kept). Therefore, I filter by `fdate`, the filing date, and keep all 10-K and 10-K/A filings with `fdate` between 2025-01-01 and 2025-12-31.

```python
### Extract Metadata for SEC Filings from WRDS
START = "2025-01-01"
END   = "2025-12-31"

# Query and Helper
def fetch_wrds_10k_2025_for_ciks(cik_list, chunk_size=400):
    out = []
    for i in range(0, len(cik_list), chunk_size):
        chunk = cik_list[i:i+chunk_size]
        in_clause = ",".join([f"'{c}'" for c in chunk])  # cik is varchar

        q = f"""
        SELECT cik, accession, form, fdate, rdate, secadate, secpdate, coname, fname, wrdsfname
        FROM wrdssec.wrds_forms
        WHERE (form = '10-K' OR form = '10-K/A')
          AND fdate BETWEEN '{START}' AND '{END}'
          AND cik IN ({in_clause})
        """
        df = db.raw_sql(q)
        out.append(df)

        print(f"Chunk {i//chunk_size + 1}: {len(df)} rows")
        print(df.form.value_counts())

    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()

wrds_10k = fetch_wrds_10k_2025_for_ciks(ciks_10, chunk_size=400)
print("\nTotal WRDS 10-K rows:", len(wrds_10k))
wrds_10k.head()
```

As the final step, I use a simple download loop to fetch each filing as a raw TXT file and save it locally. In particular, for each row I build the URL as `"https://www.sec.gov/Archives/" + the fname field` from `wrdssec.wrds_forms`. I then save the filing using the filename pattern `CIK_ACCESSION_FDATE_FORM.txt`, where the CIK is normalized to a 10-digit string for consistency, the form type is sanitized (so `10-K/A` becomes `10-K_A`), and `fdate` records the filing date. If the file already exists locally, the loop skips the download and marks it as `already_exists`. Otherwise, it downloads the file with `requests`, writes it to disk, and applies a short sleep to respect SEC rate limits (important). Finally, the loop writes a metadata log (`download_metadata_log.csv`) that records, for each attempted filing, the CIK, accession number, filing date, form type, local path, source URL, and whether the download succeeded or failed.

```python
### Path Configuration
out_dir = project_root / "Data" / "Raw_10K_WRDS" / "Test_Downloads"
out_dir.mkdir(parents=True, exist_ok=True)

### Main Download Loop
wrds_10k = wrds_10k[wrds_10k["form"].isin(["10-K", "10-K/A"])].copy()

status_rows = []
cnt_new = 0
cnt_fail = 0
cnt_exists = 0

pbar = tqdm(
    total=len(wrds_10k),
    desc="Downloading RAW txt files",
    unit="file",
    mininterval=0.2,
    smoothing=0.0,
    dynamic_ncols=True,
    leave=True,
)

for _, row in wrds_10k.iterrows():
    # Extraction & Renaming Logic
    # Using 10-digit CIK as primary identifier
    cik = cik10(row.get("cik"))
    accession = str(row.get("accession", "NA")).strip()
    fdate = str(row.get("fdate", "NA")).strip()

    # Sanitize form type for filename (e.g., 10-K/A -> 10-K_A)
    form_type = str(row.get("form", "10-K")).strip().replace("/", "_")

    fname = str(row.get("fname", "")).strip()
    url = f"https://www.sec.gov/Archives/{fname}"

    # New Naming Convention: CIK_ACCESSION_DATE_FORM.txt
    file_name = f"{cik}_{accession}_{fdate}_{form_type}.txt"
    save_path = out_dir / file_name

    status = "pending"
    error_msg = ""

    if save_path.exists():
        status = "already_exists"
        cnt_exists += 1
        tqdm.write(
            " | ".join([
                "EXISTS",
                f"cik={cik}",
                f"form={form_type}",
                f"fdate={fdate}",
                f"accession={accession}",
                f"file={save_path.name}",
            ])
        )
    else:
        try:
            resp = session.get(url, headers=HEADERS, timeout=60)
            resp.raise_for_status()

            save_path.write_text(resp.text, encoding="utf-8", errors="ignore")
            status = "downloaded"
            cnt_new += 1

            tqdm.write(
                " | ".join([
                    "NEW   ",
                    f"cik={cik}",
                    f"form={form_type}",
                    f"fdate={fdate}",
                    f"accession={accession}",
                    f"bytes={len(resp.text)}",
                ])
            )

            time.sleep(0.12)  # SEC rate limit

        except Exception as e:
            status = "failed"
            error_msg = str(e)
            cnt_fail += 1

            tqdm.write(
                " | ".join([
                    "FAIL  ",
                    f"cik={cik}",
                    f"form={form_type}",
                    f"fdate={fdate}",
                    f"accession={accession}",
                    f"err={error_msg[:180]}",
                ])
            )

    status_rows.append({
        "cik": cik,
        "accession": accession,
        "fdate": fdate,
        "form": form_type,
        "status": status,
        "local_path": str(save_path),
        "url": url,
        "error": error_msg,
    })

    pbar.update(1)
    pbar.set_postfix({"new": cnt_new, "fail": cnt_fail, "exists": cnt_exists})

pbar.close()

# Save Metadata Log
status_df = pd.DataFrame(status_rows)
log_path = out_dir / "download_metadata_log.csv"
status_df.to_csv(log_path, index=False)

print("\n" + "=" * 40)
print("PROCESS COMPLETE")
print(f"Files saved to: {out_dir}")
print(f"Metadata log saved to: {log_path}")
print(f"Counts => new: {cnt_new} | fail: {cnt_fail} | exists: {cnt_exists}")
print("=" * 40)
```

I hope this note helps you build a download pipeline that is both reliable and easy to reproduce over time. Also, the intense use of progress bars and the live preview messages are mainly for my own peace of mind, because I tend to get a bit hysteric when code runs for a long time without feedback, and I like having the leverage to monitor each download’s status and metadata as it happens, but you can absolutely skip these parts if you want.

If you face any difficulty, shoot me an email at [faisal.quaiyyum@chicagobooth.edu](mailto:faisal.quaiyyum@chicagobooth.edu).
