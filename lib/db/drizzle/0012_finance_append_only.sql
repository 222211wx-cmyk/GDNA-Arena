-- Financial evidence is append-only. Corrections are represented by a new
-- reversing journal, never by mutation or deletion of the original record.
CREATE OR REPLACE FUNCTION prevent_finance_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Financial ledger is append-only; use a reversing journal';
END;
$$;

DROP TRIGGER IF EXISTS journals_append_only ON journals;
CREATE TRIGGER journals_append_only
BEFORE UPDATE OR DELETE ON journals
FOR EACH ROW EXECUTE FUNCTION prevent_finance_ledger_mutation();

DROP TRIGGER IF EXISTS journal_entries_append_only ON journal_entries;
CREATE TRIGGER journal_entries_append_only
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION prevent_finance_ledger_mutation();