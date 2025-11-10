#!/usr/bin/env python3
"""
Script to analyze JSON files and find the top 10 decisions with the most cited provisions.
"""

import json
import os
from pathlib import Path
from collections import defaultdict

def find_all_json_files(base_dir):
    """Recursively find all JSON files in the given directory."""
    json_files = []
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith('.json'):
                json_files.append(os.path.join(root, file))
    return json_files

def analyze_provisions(json_file):
    """Read a JSON file and return the decision info with provision count."""
    try:
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        decision_id = data.get('decision_id', 'Unknown')
        numeric_id = data.get('id', 'Unknown')
        cited_provisions = data.get('citedProvisions', [])
        provision_count = len(cited_provisions)

        return {
            'decision_id': decision_id,
            'numeric_id': numeric_id,
            'provision_count': provision_count
        }
    except Exception as e:
        print(f"Error processing {json_file}: {e}")
        return None

def main():
    # Base directory to search
    base_dir = '/Users/shaharzep/knowledge-graph/full-data/extract-provisions-2a'

    print(f"Searching for JSON files in {base_dir}...")
    json_files = find_all_json_files(base_dir)
    print(f"Found {len(json_files)} JSON files")

    print("\nAnalyzing cited provisions...")
    decisions = []

    # Process each file
    for i, json_file in enumerate(json_files, 1):
        if i % 5000 == 0:
            print(f"Processed {i}/{len(json_files)} files...")

        result = analyze_provisions(json_file)
        if result:
            decisions.append(result)

    # Sort by provision count (descending)
    decisions.sort(key=lambda x: x['provision_count'], reverse=True)

    # Get top 10
    top_10 = decisions[:10]

    print("\n" + "="*80)
    print("TOP 10 DECISIONS WITH MOST CITED PROVISIONS")
    print("="*80)
    print(f"{'Rank':<6} {'Numeric ID':<12} {'Provision Count':<18} {'Decision ID'}")
    print("-"*80)

    for rank, decision in enumerate(top_10, 1):
        print(f"{rank:<6} {decision['numeric_id']:<12} {decision['provision_count']:<18} {decision['decision_id']}")

    print("="*80)

    # Additional statistics
    total_provisions = sum(d['provision_count'] for d in decisions)
    avg_provisions = total_provisions / len(decisions) if decisions else 0

    print(f"\nTotal decisions analyzed: {len(decisions)}")
    print(f"Total provisions cited: {total_provisions}")
    print(f"Average provisions per decision: {avg_provisions:.2f}")

if __name__ == '__main__':
    main()
