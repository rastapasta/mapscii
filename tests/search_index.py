#!/usr/bin/env python3
"""Offline-index regression tests; no downloads or third-party Python modules."""
import importlib.machinery
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile

path = Path(__file__).resolve().parents[1] / 'tools/maps-search-index'
loader = importlib.machinery.SourceFileLoader('search_index', str(path))
spec = importlib.util.spec_from_loader(loader.name, loader)
index = importlib.util.module_from_spec(spec)
loader.exec_module(index)


def row(place_id=1, lat='48.1', name='München'):
    return '\t'.join(map(str, [place_id, name, 'Munchen', 'Munich,慕尼黑', lat,
        '11.5', 'P', 'PPL', 'DE', '', 'BY', '', '', '', '1500000', '', '',
        'Europe/Berlin', '2026-01-01'])) + '\n'


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.source = self.folder / 'cities.txt'
        self.source.write_text(row(), encoding='utf-8')
        self.output = self.folder / 'search.sqlite'

    def test_records_duplicates_and_invalid_coordinates(self):
        self.source.write_text(row() + row() + row(2, 'nan') + 'invalid\n', encoding='utf-8')
        self.assertEqual(index.build(self.source, self.output), (1, 3))
        with sqlite3.connect(self.output) as db:
            self.assertEqual(db.execute('SELECT name FROM places').fetchone()[0], 'München')
            self.assertIn('CC BY 4.0', dict(db.execute('SELECT * FROM metadata'))['attribution'])
            self.assertEqual(db.execute("SELECT count(*) FROM place_names WHERE names MATCH 'Munich'").fetchone()[0], 1)

    def test_existing_index_and_failed_replacement_are_preserved(self):
        index.build(self.source, self.output)
        original = self.output.read_bytes()
        with self.assertRaises(ValueError):
            index.build(self.source, self.output)
        self.source.write_text('broken input\n')
        with self.assertRaises(ValueError):
            index.build(self.source, self.output, replace=True)
        self.assertEqual(self.output.read_bytes(), original)
        self.assertFalse(list(self.folder.glob('.maps-search-*')))

    def test_successful_replacement(self):
        index.build(self.source, self.output)
        self.source.write_text(row(2, name='Berlin'), encoding='utf-8')
        index.build(self.source, self.output, replace=True)
        with sqlite3.connect(self.output) as db:
            self.assertEqual(db.execute('SELECT name FROM places').fetchall(), [('Berlin',)])

    def test_zip_is_streamed_without_extracting_paths(self):
        archive = self.folder / 'cities.zip'
        with zipfile.ZipFile(archive, 'w') as zip_file:
            zip_file.writestr('../outside.txt', row())
        self.assertEqual(index.build(archive, self.output), (1, 0))
        self.assertFalse((self.folder.parent / 'outside.txt').exists())


if __name__ == '__main__':
    unittest.main()
