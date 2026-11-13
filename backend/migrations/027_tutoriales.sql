-- Tutoriales de cada persona: cuáles vio (o saltó) y en qué paso quedó el que dejó a medias.
-- {"lists": {"state": "done"}, "account": {"state": "progress", "step": 3}, "getting-started": {"state": "done"}}
ALTER TABLE users ADD COLUMN tutorials jsonb NOT NULL DEFAULT '{}'::jsonb;
