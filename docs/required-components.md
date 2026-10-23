# Required Components Analysis

## Objective

Identify all dependencies required to move one or more
components into another library.

## Example

Graph:

A -> B
B -> C
C -> D

G -> H

Request:

A
G

Result:

A
B
C
D
G
H

## Generated Reports

### JSON

Machine-readable report.

### Markdown

Developer-oriented report.

## Metrics

### Direct Dependencies

Immediate dependencies.

### Transitive Dependencies

Recursively discovered dependencies.

### Shared Dependencies

Dependencies used by several requested components.

### Max Depth

Deepest dependency level.

### Complexity Score

Migration effort estimation from 0 to 100.

## Dependency Tree

Example:

```text
A
└── B
    └── C
        └── D

G
└── H
```