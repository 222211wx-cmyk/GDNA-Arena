DO $$
BEGIN
  IF to_regclass('public.citizen_dna') IS NULL THEN
    RAISE NOTICE 'citizen_dna does not exist yet; startup creation will add its user reference';
  ELSIF EXISTS (
    SELECT 1
    FROM citizen_dna AS dna
    LEFT JOIN users ON users.id = dna.citizen_id
    WHERE users.id IS NULL
  ) THEN
    RAISE NOTICE 'citizen_dna has orphaned historical rows; ownership constraint was not inferred';
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.citizen_dna'::regclass
      AND confrelid = 'public.users'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE citizen_dna
      ADD CONSTRAINT citizen_dna_citizen_id_users_id_fk
      FOREIGN KEY (citizen_id) REFERENCES users(id);
  END IF;
END
$$;