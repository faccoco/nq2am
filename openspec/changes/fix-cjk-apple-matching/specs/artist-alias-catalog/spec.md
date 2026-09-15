## ADDED Requirements

### Requirement: Local catalog artist alias index
The system SHALL keep a local artist-alias index compiled from licensed public dumps and SHALL use it, together with the bundled reviewed alias table, as alias evidence during matching. The index SHALL include MusicBrainz artist aliases (CC0), VocaDB names (CC BY 4.0), UtaiteDB names (CC BY 4.0), and TouhouDB names (CC BY 4.0). Auto-imported names SHALL be limited to localized Japanese, romaji, and English artist names.

#### Scenario: Bundled aliases work before any download
- **WHEN** the user has never downloaded the catalog index
- **THEN** matching still applies the bundled reviewed alias table and does not fail open for lack of a local index

#### Scenario: Catalog download includes VocaDB family dumps and MusicBrainz
- **WHEN** the user downloads the alias catalog
- **THEN** compilation includes MusicBrainz general-artist aliases, VocaDB Vocaloid names, UtaiteDB utaite names, and TouhouDB Touhou names, and the settings UI reports per-source group counts

#### Scenario: Compiled group is available after download
- **WHEN** a download successfully compiles a MusicBrainz or VocaDB entity that lists both a Japanese name and a romanized or English name
- **THEN** subsequent matching treats those names as alias-equivalent and records catalog alias evidence

#### Scenario: An artist collected by several sources stays usable
- **WHEN** the same artist is present in more than one dump, so compilation emits several identical or overlapping groups for that artist
- **THEN** index construction SHALL treat groups sharing at least two names as one entity and SHALL keep those names usable as alias evidence, rather than reading the repetition as a naming conflict

#### Scenario: A name reused by different entities stays unusable
- **WHEN** a name appears in groups that share no other name, indicating separate artists that happen to share it
- **THEN** index construction SHALL drop that name so it never links the unrelated entities

#### Scenario: Search hints and legal names are excluded
- **WHEN** a MusicBrainz alias is typed as a search hint or legal name
- **THEN** compilation SHALL NOT add it to the local index unless a human later adds it to the bundled reviewed table

#### Scenario: Match time does not download dumps
- **WHEN** a matching job is running
- **THEN** the matcher reads only the bundled table and the already compiled local index and SHALL NOT download catalog dumps or call MusicBrainz or VocaDB APIs

### Requirement: Manual catalog download from Matching settings
The system SHALL expose an explicit download control in Matching settings, in English and Chinese, that downloads the licensed dumps, compiles the local index, and atomically replaces the previous index. Download SHALL NOT start automatically with a match job or on a timer. While a download is running the UI SHALL show progress and a cancel control. After a successful download the UI SHALL show the catalog download date.

#### Scenario: User downloads the catalog
- **WHEN** the user activates the download control while no download is in progress
- **THEN** the system downloads the configured dumps, compiles the filtered index, replaces the previous local index only after a successful compile, and shows the download date, dump date when known, group count, and sources

#### Scenario: Download reports progress
- **WHEN** a catalog download is in progress
- **THEN** the settings UI shows a progress bar, downloaded and total size when known, download speed and remaining time when known, a phase status for the current dump, and a cancel control instead of a second download action

#### Scenario: Dumps download one at a time
- **WHEN** a catalog download fetches MusicBrainz, VocaDB, UtaiteDB, and TouhouDB dumps
- **THEN** the next dump does not start until the previous dump has finished downloading

#### Scenario: A single dump is fetched over parallel connections
- **WHEN** a dump host reports its size and honors Range requests
- **THEN** the system splits that dump into fixed-size segments and fetches several segments concurrently over separate connections, rather than reading the whole dump from one connection

#### Scenario: A refused or truncated segment is retried
- **WHEN** one segment request is answered with a retryable status such as 503, or its transfer ends before the segment is complete
- **THEN** that segment is retried with backoff while the other segments continue, its already stored bytes are kept, and the download only fails after the retries are exhausted

#### Scenario: Dump requests are not identified as this project
- **WHEN** the system requests a dump file or its listing
- **THEN** the request carries no project-specific User-Agent, because the dump hosts are plain file servers rather than the MusicBrainz web service

#### Scenario: User cancels a catalog download
- **WHEN** the user activates cancel while dumps are being downloaded
- **THEN** the in-progress fetch stops, the previous local index remains in use, partial dump files are kept for resume, and the download control becomes available again

#### Scenario: Interrupted dump download resumes
- **WHEN** a dump download is cancelled or fails after some bytes are written, and the user starts download again
- **THEN** the system resumes that dump with an HTTP Range request from the already stored bytes instead of restarting from byte 0, unless the remote dump has changed

#### Scenario: Unchanged complete dumps are not fetched again
- **WHEN** a previously completed dump still matches the remote ETag or Last-Modified
- **THEN** the next catalog download reuses the local dump file and does not GET the body again

#### Scenario: Download is already in progress
- **WHEN** the user activates the download control while a download is running
- **THEN** the system does not start a second download and the download control remains disabled until the in-progress download finishes or is cancelled

#### Scenario: Download fails
- **WHEN** a download or compile fails
- **THEN** the previous local index remains in use, matching is unchanged, and the settings UI reports the failure

#### Scenario: Match job is in flight
- **WHEN** a matching job is using the current index and a download completes
- **THEN** that job continues with the index it started with; later jobs use the new index

#### Scenario: Attribution is retained
- **WHEN** the local index includes VocaDB, UtaiteDB, or TouhouDB names
- **THEN** the repository or local catalog metadata records CC BY 4.0 attribution for those sources
