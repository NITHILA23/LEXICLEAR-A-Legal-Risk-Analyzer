# risk_detection.py
# Step 5: Risk Keyword Detection

# Load dataset clauses
with open("dataset/tos_clauses.txt", "r", encoding="utf-8") as f:
    dataset_clauses = [line.strip() for line in f if line.strip()]

print(f"Total clauses loaded from dataset: {len(dataset_clauses)}")