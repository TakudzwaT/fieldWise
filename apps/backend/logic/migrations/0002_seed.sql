-- Demo farmers: the eight farms in the Felix app, at the same points, with
-- crops the questionnaires cover. Names are invented. Phone numbers start
-- +265 0, which no Malawi number does, and the channel is "sim", so nothing
-- sent to them leaves FieldWise.

INSERT INTO farmers (id, name, farm_name, phone, crop, latitude, longitude, channel, created_at) VALUES
  ('F014', 'Chimwemwe Phiri', 'Chimwemwe Farm',    '+2650000000014', 'maize',   -13.0368, 33.4885, 'sim', '2026-10-17T00:00:00Z'),
  ('F027', 'Grace Mbewe',     'Kasungu North',     '+2650000000027', 'beans',   -13.0323, 33.4918, 'sim', '2026-10-17T00:00:00Z'),
  ('F043', 'Mphatso Zulu',    'Mphatso Fields',    '+2650000000043', 'maize',   -13.0407, 33.4932, 'sim', '2026-10-17T00:00:00Z'),
  ('F056', 'John Banda',      'Banda Family Farm', '+2650000000056', 'tomato',  -13.0430, 33.4855, 'sim', '2026-10-17T00:00:00Z'),
  ('F062', 'Esther Chirwa',   'Riverbend Growers', '+2650000000062', 'cabbage', -13.0334, 33.4858, 'sim', '2026-10-17T00:00:00Z'),
  ('F075', 'Peter Mwale',     'Central Harvest',   '+2650000000075', 'maize',   -13.0389, 33.4961, 'sim', '2026-10-17T00:00:00Z'),
  ('F084', 'Ruth Nyirenda',   'Dedza Road Farm',   '+2650000000084', 'tomato',  -13.0414, 33.4829, 'sim', '2026-10-17T00:00:00Z'),
  ('F091', 'Joseph Tembo',    'Chulu Hills',       '+2650000000091', 'beans',   -13.0304, 33.4954, 'sim', '2026-10-17T00:00:00Z');
