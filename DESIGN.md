# DTCC Twin Design

## Purpose

DTCC Twin is the user-facing experience of DTCC Platform. It enables people to
build, explore, understand, save, share, and present digital twins of cities.

DTCC Twin provides two complementary experiences:

- **Atlas** is the interactive workspace for creating and exploring digital
  twins.
- **Table** presents curated, published data through projection onto physical
  3D-printed city models.

Atlas and Table share the same platform contracts and a coherent visual
identity, but their workflows and interaction patterns are adapted to their
different settings.

> DTCC Twin should make the complete process of building and experiencing a
> digital twin coherent, compelling, traceable, and easy to understand.

## Place in DTCC Platform

DTCC Core is the shared semantic foundation. It owns the DTCC Model, general
data input and output, data modeling, broadly useful data processing and
generation, and the common Dataset, manifest, and package contracts.

DTCC Sim contributes simulation capabilities through those same contracts. It
may depend on specialized numerical software that does not belong in the lean
Core environment. The Core--Sim boundary is guided by both semantic scope and
dependency weight: general city-model operations belong in Core, while
scenario-oriented simulations and solvers belong in Sim.

DTCC Twin owns the user-facing application layer. Its responsibilities include:

- selecting a geographic domain and requesting data generation or simulation;
- orchestrating work and communicating progress;
- composing results into an interactive digital-twin workspace;
- importing user data through DTCC Core's data-admission boundary;
- visualizing and controlling semantic DTCC data;
- saving, reopening, exporting, sharing, and publishing digital twins;
- storing and distributing published Dataset Packages;
- curating published results into Table experiences;
- selecting physical Table Models and calibrating Table Installations.

DTCC Twin must not become a second implementation of data processing, domain
models, or simulation logic owned by DTCC Core or DTCC Sim. Repository
organization does not prescribe runtime topology: these responsibilities may
be implemented by one or more processes or deployable components.

## Design principles

### One semantic authority

DTCC Model is the semantic authority for all digital-twin domain data. Data may
originate in Core, Sim, an external provider, or a user import, but it becomes
DTCC data only after it has been represented and validated as DTCC Model data.

DTCC Twin may create render-ready, streamed, tiled, image, or video derivatives
for efficient presentation. Such derivatives are not competing domain models
and must remain traceable to their canonical DTCC Model data.

### Composition before download

Atlas is a digital-twin builder, not primarily a file-download tool. Generated,
simulated, and imported results become usable parts of a Twin Workspace. Export
and download remain important explicit operations on those results and on the
workspace as a whole.

### Discovery instead of Dataset-specific integration

Atlas discovers Dataset Definitions and their parameters from the platform at
runtime. User interfaces, execution, and presentation must be driven by common
contracts and semantic model types rather than hard-coded Dataset names,
filenames, package locations, or implementation modules.

A new Dataset Definition returning existing DTCC Model types should require no
Dataset-specific change in Twin. A genuinely new model type may require one new
model-level presentation capability, not separate integration for every Dataset
that returns that type.

### Progressive usefulness

Long-running work should expose meaningful progress and make completed results
available without waiting for unrelated work. Atlas builds the smallest useful
base twin first and enriches it progressively.

### Facts, editorial presentation, and application state are distinct

Dataset identity, request, provenance, units, sources, licenses, health,
warnings, and limitations travel with the Dataset Realization and Package.

Audience-specific narrative, presentation choices, and Table curation may add
context but must not replace or contradict those facts. Camera state, layer
order, styling, interface state, and projection calibration belong to Twin and
are not part of the semantic DTCC Model.

### Explicit and reproducible publication

Publication creates immutable, versioned results. Published twins and Table
releases pin the exact Dataset Package versions on which they depend. Updating
published content creates a new revision rather than silently changing an
existing one.

### Explicit privacy boundary

Saving work is not the same as publishing it. Imported or private data is never
made public implicitly. Edit authority, private read access, and public read
access are separate concerns; an opaque URL is not by itself an authorization
model.

### Shared product language, purpose-specific interaction

Atlas and Table should be recognizably parts of one distinct, modern product.
They share visual language, terminology, provenance patterns, and interaction
quality without being forced into identical layouts or controls.

## Core concepts

### Dataset Definition

A **Dataset Definition** is a named, reusable, parameterized capability. It
describes what can be generated, which parameters are accepted, what semantic
result it produces, its coverage and limitations, and the capabilities needed
to execute and present it.

For example, a Dataset Definition may express: generate a city model for these
bounds and parameters, or simulate an urban wind field for this domain and
scenario.

### Dataset Request

A **Dataset Request** is one validated invocation of a Dataset Definition. It
records the exact domain, parameters, inputs, and requested semantic product.
Semantic product selection is distinct from serialization format: choosing
what data to generate must not be conflated with choosing how to encode it.

### Dataset Realization

A **Dataset Realization** is the concrete result of a Dataset Request. It is a
native DTCC Model object with immutable identity and context recording the
actual runtime provenance, health, warnings, inputs, and software versions.

### Dataset Package

A **Dataset Package** is a portable snapshot of one Dataset Realization. The
standard archive form uses the `.dtccpkg` suffix and contains:

```text
manifest.json
artifacts/...
```

The manifest is the authoritative index. It contains identity, factual
metadata, provenance, presentation guidance, health and warnings, the exact
request, and descriptions of all artifacts. Metadata need not be duplicated in
a separate file.

Every package containing semantic digital-twin data includes a canonical DTCC
Model artifact. It may also include derived artifacts such as previews,
thumbnails, browser-optimized representations, images, image sequences, or
video. Artifact roles, relationships, formats, media types, coordinate frames,
sizes, and integrity information are explicit.

Purely presentational or operational assets that contain no domain data, such
as a calibration test pattern, need not pretend to be DTCC Model objects. They
remain explicitly classified as presentation or installation assets.

### Publication

A **Publication** is an immutable, versioned Dataset Package registered in the
Package Catalog. Its publication identity is distinct from the name of the
Dataset Definition that produced it.

### Twin Workspace

A **Twin Workspace** is a mutable Atlas project. It contains:

- a geographic domain and coordinate context;
- ordered references to Dataset Realizations or published Package versions;
- imported data admitted through DTCC Core;
- generation recipes and Dataset Requests needed for reproduction;
- layer, scene, camera, styling, and interaction state;
- workspace-level annotations and presentation choices.

A Twin Workspace is a composition of Dataset results, not another meaning of
Dataset.

### Published Twin

A **Published Twin** is a read-only, revisioned snapshot of a Twin Workspace.
It has a stable URL suitable for external sharing. The URL continues to resolve
to the same revision; later edits produce a new revision or an explicitly
updated reference.

### Table Model

A **Table Model** describes a replaceable physical 3D-printed city model. It
defines a stable identity, geographic domain, coordinate reference system,
physical footprint and dimensions, scale, orientation, and reference
information needed for projection. It contains no installation-specific
hardware or calibration state.

Table Models are not assumed to be square, fixed to one physical size, or tied
to a particular coordinate reference system.

### Table Installation

A **Table Installation** describes one operational projection setup: its
projector or display, projection surface, controller, local content cache,
active Table Model, and saved calibrations. One installation may support
several Table Models, with one active at a time.

### Table Catalog Release and Table Experience

A **Table Catalog Release** is an immutable, curated collection compatible with
one Table Model. It pins Dataset Package versions and adds Table-specific
ordering, editorial context, declared interactions, and presentation choices.

A **Table Experience** is one visitor-selectable entry in a release. It may use
one or several Dataset Packages and one or several artifacts. It combines
published data with a coherent story without disguising the identity or
provenance of its components.

## DTCC Model and Protobuf invariant

All digital-twin domain data that DTCC Platform accepts, generates, simulates,
stores, or publishes must be representable faithfully in DTCC Model. If valid
platform data cannot be represented, DTCC Model is incomplete and must be
extended. DTCC Twin must not work around such a gap by inventing an
application-specific domain model or by treating a lossy display format as the
source of truth.

The versioned DTCC Protobuf representation is the canonical binary exchange
representation of DTCC Model. Every supported DTCC Model type must support a
complete round trip:

```text
DTCC Model object -> Protobuf -> DTCC Model object
```

The round trip preserves all facts required to give the object the same
semantic meaning, including as applicable:

- concrete model and geometry types;
- identifiers, object hierarchy, and relationships;
- geometry, topology, dimensionality, and coordinate precision;
- coordinate reference systems, transforms, bounds, and orientation;
- fields, values, components, association, units, and descriptions;
- classifications, markers, material or domain labels, and other typed
  attributes;
- temporal, scenario, ensemble, or other semantic axes;
- all other model properties that affect interpretation or later computation.

An explicitly documented canonical normalization, such as equivalent ordering,
may be acceptable; silent loss, flattening, type substitution, or precision
loss is not.

Protobuf schemas are versioned exchange contracts. Readers validate supported
versions and fail clearly on incompatible data. Round-trip coverage is a
required model-level acceptance test, not an application-specific check.

This is an architectural requirement, not an assertion that every current
model class already satisfies it. A type that fails this contract is not ready
for canonical exchange until DTCC Core is fixed; it does not earn a
Twin-specific exception.

Dataset context and package information remain outside the model artifact when
they are not semantic properties of the model itself. The Package manifest
preserves provenance, request, health, presentation guidance, and artifact
relationships alongside the canonical model artifact.

## Catalogs and discovery

DTCC Twin distinguishes three catalogs.

### Capability Catalog

The **Capability Catalog** describes what DTCC Core and DTCC Sim can generate.
Each entry supplies enough structured information for discovery and execution,
including identity, title, explanation, parameter schema, semantic result type,
coverage, required inputs, expected cost or duration, output capabilities, and
availability.

The catalog has explicit refresh or revision semantics. A conforming new
Dataset Definition becomes available in Atlas after catalog refresh without a
Twin deployment or Dataset-specific code change.

### Package Catalog

The **Package Catalog** stores immutable Dataset Package versions and provides
validated discovery and retrieval of their manifests and artifacts. It
preserves integrity, ownership, idempotency, atomic publication, auditability,
retraction, and reproducible version addressing.

Its internal storage layout need not match a `.dtccpkg` archive, but users and
applications can retrieve the same logical package and export the portable
archive form.

### Table Catalog

The **Table Catalog** contains curated, versioned releases for Table Models. It
is not an unfiltered view of the Package Catalog. A new Dataset Definition may
automatically become a candidate for curation, but it never becomes part of a
public Table release without an explicit editorial and operational decision.

The configuration used to author a release is declarative and versioned. Its
serialization syntax is not a product-level design decision. Table consumes a
validated release, not a mutable authoring file.

## Atlas experience

### Select and build

Atlas begins with a distinctive geographic overview rather than an empty
application form or conventional download catalog. The user selects a
two-dimensional region and chooses **Build Twin**.

Atlas requests the smallest useful base twin and communicates progress while
it is created. As soon as the base geometry is ready, the experience moves into
an interactive 3D view while preserving geographic context. Additional base
components may complete progressively.

The exact base recipe and latency targets are product requirements configured
separately from this high-level design.

### Enrich and explore

Within a Twin Workspace, the user can:

- discover compatible data and simulation capabilities;
- configure their declared parameters;
- generate results and add them as layers or scene components;
- inspect, reorder, show, hide, style, and control those components;
- interact with spatial, temporal, scenario, case, field, or other declared
  semantic dimensions;
- inspect source, request, generation method, time, version, license, health,
  warnings, and limitations;
- compare results while retaining their separate identities and provenance.

Atlas derives forms and ordinary presentation behavior from common contracts.
It does not infer product meaning from filenames or maintain parallel metadata
for known Dataset names.

### Import user data

User imports cross an independent trust boundary. DTCC Core validates and
normalizes supported input into DTCC Model while the original source may be
retained as a provenance artifact.

Atlas must not silently flatten an unsupported input into a weaker application
type. If the data has valid DTCC semantics that the model cannot represent, the
model must be extended. Malformed, ambiguous, unsupported, or unsafe input
fails clearly.

### Save, export, and publish

Saving or bookmarking preserves the complete Twin Workspace, not only its
bounds or camera position.

Users can export individual Dataset Packages and an exchangeable snapshot of
the complete Twin. A full-Twin export preserves component identities,
provenance, pinned versions or included packages, recipes, and relevant scene
state rather than flattening the composition into an unexplained file.

Publishing a twin creates an explicit read-only revision with a stable URL.
The publication flow shows what will be included and enforces the applicable
access policy. A mutable editor session is never used as the public artifact.

### Publish to Table

Publishing from Atlas to Table is a curation operation, not a direct connection
from a browser session to a projector. The user selects a target Table Model,
chooses compatible results, prepares the visitor story and interactions, and
previews the presentation.

The publication path validates geographic frame, package versions, artifact
integrity, presentation capabilities, and Table compatibility before creating
a new Table Catalog Release.

## Table experience

### Static but interactive

Table consumes pre-generated, published content. It does not run Dataset
generation, simulation, or live provider acquisition during the visitor
experience.

Static does not mean non-interactive. Published content may support playback,
time or case selection, field and color controls, comparison, annotations, and
other interactions over already published data.

### Select and understand

The active Table Model determines the compatible catalog release. A visitor can
select a Table Experience and understand:

- what is being shown and why it matters;
- how to read and interact with it;
- where the data came from and when it was produced;
- how it was generated;
- which Package versions, assumptions, and limitations apply.

Scientific and factual information comes from the Package manifests.
Table-specific editorial framing explains why the result is interesting in the
current setting. Editorial content must not hide or contradict provenance,
warnings, licenses, or limitations.

### Declared controls

Controls are derived from declared semantic and presentation capabilities, not
hard-coded Dataset identifiers. Examples include:

- play, pause, and scrubbing for temporal content;
- selection among times, frames, scenarios, or cases;
- field, unit, range, legend, and color-scale controls;
- layer visibility and comparison controls;
- annotations and explanatory callouts.

The contract declares meaning and available operations; the client chooses an
appropriate control presentation.

### Projection, control, and administration

Table separates three logical surfaces:

- the **projection surface**, a clean fullscreen visualization aligned with the
  physical model;
- the **controller**, used to browse stories, inspect provenance, and operate
  visitor-facing controls;
- **administration and calibration**, used for model selection, catalog
  synchronization, installation status, authentication, and advanced setup.

These are logical responsibilities and need not imply three applications or
devices. Credentials, calibration handles, diagnostics, and administrative
state must not appear on the ordinary public projection surface.

### Model switching and calibration

Changing the active physical model selects its Table Model and compatible
Catalog Release. The installation restores a saved compatible calibration when
available and requires calibration when none exists. Incompatible content is
not projected.

Calibration belongs to the combination of Table Installation, Table Model, and
projection setup. It is not keyed only by a Dataset or by coincidentally equal
geographic bounds.

Manual calibration is a complete and reliable baseline. Assisted or automatic
calibration may be added when suitable reference marks or sensing hardware are
available, but manual correction and recovery remain possible. Accuracy and
repeatability are acceptance requirements; this design does not mandate a
particular calibration algorithm or device.

### Releases and offline operation

A Table Catalog Release is deployed atomically and pins every referenced
Package version. A Table Installation retains a validated local copy of its
active release so the ordinary visitor experience does not depend on continuous
network access. A failed update does not invalidate the last complete release,
and an operator can select an earlier release when recovery requires it.

## Work, progress, and failure

Generation and simulation may execute locally or remotely. Twin presents one
coherent job lifecycle with validation, queued and running states, meaningful
progress, cancellation where supported, success, and actionable failure.

A completed Dataset Realization remains valid if an optional presentation step
fails. Durable publication happens only after all required package content has
been validated and committed atomically.

Coverage, credentials, dependency availability, expected duration, and known
limitations are discoverable before execution where possible. Missing or
unsafe required input fails clearly; domain meaning is never changed by a
silent fallback.

## Traceability and trust

Every displayed semantic result is traceable to its Dataset Definition,
validated request, inputs, canonical model artifact, generating software,
Package version, and relevant limitations.

Provenance supports understanding, assessment, and reproduction; it does not by
itself guarantee scientific validity. Degraded, partial, synthetic, stale, or
uncalibrated results are labeled as such and retain that status through export
and publication.

## Non-goals

This design does not:

- prescribe a frontend framework, renderer, database, service topology,
  deployment platform, or authoring-file syntax;
- require compatibility with the internal APIs or behavior of earlier
  applications;
- move data generation, conversion, DTCC Model ownership, or simulation solvers
  into DTCC Twin;
- require Table to generate data during presentation;
- make every available Dataset part of a public Table release;
- require every artifact to be Protobuf or forbid derived render formats;
- allow a derived artifact to replace the canonical DTCC Model representation
  of semantic data;
- promise automatic calibration without the hardware and acceptance evidence
  needed to support it;
- define a one-off exhibit for one city or physical model;
- require real-time collaborative editing or direct integration with particular
  social networks.

## Acceptance boundary

The design is realized when ordinary end-to-end workflows satisfy these
properties:

- A conforming new Core or Sim Dataset Definition appears in Atlas without
  Dataset-specific Twin code after Capability Catalog refresh.
- Every Dataset Realization uses DTCC Model and passes lossless semantic
  Protobuf round-trip tests before it is treated as canonical exchange data.
- Atlas can progressively build a Twin, enrich it, save and reopen the complete
  workspace, export it, and publish a stable read-only revision.
- A result displayed in Atlas or Table can be traced to its canonical model
  artifact, exact request, pinned Package version, and provenance.
- Publishing to Table creates an atomic, curated release for a named Table
  Model rather than exposing a live Atlas session or global package list.
- A new physical model is introduced through a new Table Model definition and
  compatible release, without forking the Table product.
- A Table Installation can switch models, restore or request the correct
  calibration, and operate its last complete release without continuous network
  access.
- Table controls come from declared semantics and presentation capabilities,
  not filenames or Dataset names.

## Deferred choices

The following choices are intentionally left to later product, UX, and
implementation work within the boundaries above:

- frontend frameworks and rendering technologies;
- runtime service and deployment topology;
- the authoring syntax for Table Models and releases;
- the exact baseline Dataset recipe and measured latency targets for Build Twin;
- the exact access-policy and identity mechanisms for private and public twins;
- the exact self-contained archive contract for a complete Twin Workspace;
- the controller and administration device arrangement;
- calibration hardware, model-detection mechanisms, and algorithms;
- exact browser-optimized artifact formats and streaming strategies.
