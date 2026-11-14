-- Area crosswalk: one place to map suburbs, portal regions, Property24 cities and job-ad cities to a metro and
-- province, so datasets can be joined by place. Runs after property.sql and the jobs views.
CREATE SCHEMA IF NOT EXISTS geo;

CREATE TABLE IF NOT EXISTS geo.metros (area TEXT PRIMARY KEY, metro TEXT NOT NULL, province TEXT NOT NULL);
INSERT INTO geo.metros (area, metro, province) VALUES
  ('Johannesburg','City of Johannesburg','Gauteng'), ('Sandton','City of Johannesburg','Gauteng'),
  ('Randburg','City of Johannesburg','Gauteng'), ('Roodepoort','City of Johannesburg','Gauteng'),
  ('Midrand','City of Johannesburg','Gauteng'), ('Soweto','City of Johannesburg','Gauteng'),
  ('Fourways','City of Johannesburg','Gauteng'), ('Rosebank','City of Johannesburg','Gauteng'),
  ('Pretoria','City of Tshwane','Gauteng'), ('Centurion','City of Tshwane','Gauteng'),
  ('East Rand','Ekurhuleni','Gauteng'), ('Benoni','Ekurhuleni','Gauteng'), ('Boksburg','Ekurhuleni','Gauteng'),
  ('Germiston','Ekurhuleni','Gauteng'), ('Kempton Park','Ekurhuleni','Gauteng'), ('Alberton','Ekurhuleni','Gauteng'),
  ('Edenvale','Ekurhuleni','Gauteng'), ('Springs','Ekurhuleni','Gauteng'), ('Isando','Ekurhuleni','Gauteng'),
  ('West Rand','West Rand','Gauteng'), ('Krugersdorp','West Rand','Gauteng'),
  ('Gauteng South','Sedibeng','Gauteng'), ('Vereeniging','Sedibeng','Gauteng'),
  ('Cape Town','City of Cape Town','Western Cape'), ('Bellville','City of Cape Town','Western Cape'),
  ('Durbanville','City of Cape Town','Western Cape'), ('Brackenfell','City of Cape Town','Western Cape'),
  ('Somerset West','City of Cape Town','Western Cape'),
  ('Durban','eThekwini','KwaZulu-Natal'), ('Umhlanga','eThekwini','KwaZulu-Natal'), ('Pinetown','eThekwini','KwaZulu-Natal'),
  ('Port Elizabeth','Nelson Mandela Bay','Eastern Cape'), ('Gqeberha','Nelson Mandela Bay','Eastern Cape'),
  ('Nelson Mandela Bay','Nelson Mandela Bay','Eastern Cape'),
  ('East London','Buffalo City','Eastern Cape'), ('Bloemfontein','Mangaung','Free State')
ON CONFLICT (area) DO UPDATE SET metro = EXCLUDED.metro, province = EXCLUDED.province;

DROP VIEW IF EXISTS analyst.areas CASCADE;
CREATE VIEW analyst.areas AS
WITH a AS (
    SELECT 'suburb' AS level, suburb AS area, region AS parent, province, portal AS seen_in
    FROM analyst.property_listings WHERE suburb IS NOT NULL
    UNION
    SELECT 'region/city', region, NULL, province, portal FROM analyst.property_stock WHERE NOT is_province_total
    UNION
    SELECT 'job city', city, NULL, province, 'jobs' FROM analyst.jobs WHERE city IS NOT NULL
)
SELECT a.level, a.area, a.parent, COALESCE(a.province, m.province, pm.province) AS province,
       COALESCE(m.metro, pm.metro) AS metro, string_agg(DISTINCT a.seen_in, ', ') AS seen_in
FROM a LEFT JOIN geo.metros m ON m.area = a.area LEFT JOIN geo.metros pm ON pm.area = a.parent
GROUP BY a.level, a.area, a.parent, COALESCE(a.province, m.province, pm.province), COALESCE(m.metro, pm.metro);
