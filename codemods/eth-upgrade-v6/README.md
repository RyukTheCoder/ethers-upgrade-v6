# eth-upgrade-v6

An automated codemod to migrate ethers.js v5 to v6

## Installation

```bash
# Install from registry
codemod run eth-upgrade-v6

# Or run locally
codemod run -w workflow.yaml
```

## Usage

Document the exact migration this codemod performs before publishing. At minimum, cover:

- The concrete syntax or API patterns it rewrites
- The file types or paths it targets
- Important preserve/no-op cases and exclusions

## Development

```bash
# Test the transformation
yarn test

# Validate the workflow
codemod workflow validate -w workflow.yaml

# Publish to registry
codemod login
codemod publish
```

## License

MIT

## Skill Installation

```bash
yarn dlx codemod@latest eth-upgrade-v6
```
