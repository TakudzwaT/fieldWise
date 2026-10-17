"""Azure Table Storage: one table each for cells, hourly rows and daily rows.

Rows are keyed by cell (PartitionKey) and local time or date (RowKey). ISO
strings sort in time order, so date ranges and pruning are key-range queries.
"""

from azure.core.exceptions import ResourceNotFoundError
from azure.data.tables import TableServiceClient, UpdateMode

CELLS_PARTITION = "cell"
# Table Storage transactions take at most 100 operations, all in one partition.
TRANSACTION_SIZE = 100


class Store:
    def __init__(self, connection_string: str):
        service = TableServiceClient.from_connection_string(connection_string)
        self.cells = service.create_table_if_not_exists("cells")
        self.hourly = service.create_table_if_not_exists("hourly")
        self.daily = service.create_table_if_not_exists("daily")

    def get_cell(self, cell_id: str) -> dict | None:
        try:
            return _cell(self.cells.get_entity(CELLS_PARTITION, cell_id))
        except ResourceNotFoundError:
            return None

    def list_cells(self) -> list[dict]:
        entities = self.cells.query_entities("PartitionKey eq @pk", parameters={"pk": CELLS_PARTITION})
        return [_cell(e) for e in entities]

    def save_cell(self, cell_id: str, lat: float, lon: float, fetched_at: str, name: str | None = None):
        entity = {"PartitionKey": CELLS_PARTITION, "RowKey": cell_id, "latitude": lat, "longitude": lon, "fetched_at": fetched_at}
        if name:
            entity["name"] = name
        self.cells.upsert_entity(entity, mode=UpdateMode.MERGE)

    def save_rows(self, cell_id: str, hours: list[dict], days: list[dict]):
        # Hourly rows are replaced: a newer forecast for the same hour wins.
        self._upsert(self.hourly, cell_id, hours, "time", UpdateMode.REPLACE)
        # Daily rows are merged: the oldest days in a fetch have no risk_7d, and
        # merging keeps the value an earlier fetch calculated for them.
        self._upsert(self.daily, cell_id, days, "date", UpdateMode.MERGE)

    def read_hourly(self, cell_id: str, start: str, end: str) -> list[dict]:
        return self._range(self.hourly, cell_id, start, end, "time")

    def read_daily(self, cell_id: str, start: str, end: str) -> list[dict]:
        return self._range(self.daily, cell_id, start, end, "date")

    def prune(self, cell_id: str, hourly_before: str, daily_before: str) -> int:
        return self._delete_before(self.hourly, cell_id, hourly_before) + self._delete_before(self.daily, cell_id, daily_before)

    def _upsert(self, table, cell_id, rows, key, mode):
        operations = [
            ("upsert", {"PartitionKey": cell_id, "RowKey": row[key], **{k: v for k, v in row.items() if k != key and v is not None}}, {"mode": mode})
            for row in rows
        ]
        for i in range(0, len(operations), TRANSACTION_SIZE):
            table.submit_transaction(operations[i : i + TRANSACTION_SIZE])

    def _range(self, table, cell_id, start, end, key):
        entities = table.query_entities(
            "PartitionKey eq @pk and RowKey ge @start and RowKey lt @end",
            parameters={"pk": cell_id, "start": start, "end": end},
        )
        rows = [{key: e["RowKey"], **{k: v for k, v in e.items() if k not in ("PartitionKey", "RowKey")}} for e in entities]
        return sorted(rows, key=lambda row: row[key])

    def _delete_before(self, table, cell_id, before):
        entities = table.query_entities(
            "PartitionKey eq @pk and RowKey lt @before",
            parameters={"pk": cell_id, "before": before},
            select=["PartitionKey", "RowKey"],
        )
        operations = [("delete", e) for e in entities]
        for i in range(0, len(operations), TRANSACTION_SIZE):
            table.submit_transaction(operations[i : i + TRANSACTION_SIZE])
        return len(operations)


def _cell(entity) -> dict:
    cell = {"cell": entity["RowKey"], "latitude": entity["latitude"], "longitude": entity["longitude"], "fetched_at": entity.get("fetched_at")}
    if entity.get("name"):
        cell["name"] = entity["name"]
    return cell
