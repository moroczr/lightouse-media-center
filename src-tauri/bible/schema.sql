CREATE TABLE IF NOT EXISTS translations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
    translation TEXT NOT NULL REFERENCES translations(id),
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    chapters INTEGER NOT NULL CHECK (chapters > 0),
    position INTEGER NOT NULL,
    PRIMARY KEY (translation, id),
    UNIQUE (translation, position)
);
CREATE TABLE IF NOT EXISTS verses (
    translation TEXT NOT NULL,
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL CHECK (chapter > 0),
    verse INTEGER NOT NULL CHECK (verse > 0),
    text TEXT NOT NULL,
    PRIMARY KEY (translation, book, chapter, verse),
    FOREIGN KEY (translation, book) REFERENCES books(translation, id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS book_aliases (
    translation TEXT NOT NULL,
    book TEXT NOT NULL,
    source_book_name TEXT NOT NULL,
    hungarian_abbreviation TEXT NOT NULL,
    PRIMARY KEY (translation, book),
    FOREIGN KEY (translation, book) REFERENCES books(translation, id)
);
CREATE TABLE IF NOT EXISTS translation_sources (
    translation TEXT PRIMARY KEY NOT NULL REFERENCES translations(id),
    collection TEXT NOT NULL,
    repository_url TEXT NOT NULL,
    source_commit TEXT NOT NULL,
    source_file TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    metadata_file TEXT NOT NULL,
    metadata_text TEXT NOT NULL
);
