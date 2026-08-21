DO $$
BEGIN
  IF to_regclass('public.citizen_dna') IS NOT NULL THEN
    UPDATE citizen_dna AS dna
    SET username = 'deleted_user_' || dna.citizen_id,
        dna_string = LEFT(dna.dna_string, 56) || 'AAAAAAAA'
    WHERE NOT EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = dna.citizen_id
    );
  END IF;
END
$$;