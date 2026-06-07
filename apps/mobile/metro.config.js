// Config Metro pour monorepo pnpm : permet à l'app mobile de résoudre et
// transpiler le package partagé `@resto/shared` (code source TS hors du dossier app).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1) Surveiller tout le monorepo (pour packages/shared).
config.watchFolders = [monorepoRoot];

// 2) Chercher les modules dans l'app PUIS à la racine du monorepo.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// 3) pnpm utilise des symlinks ; ne pas remonter la hiérarchie au-delà.
config.resolver.disableHierarchicalLookup = true;

// 4) Ignorer les dossiers temporaires de pnpm (`*_tmp_*`) : sinon, sous Windows
//    sans watchman, le watcher de Metro plante quand pnpm les crée/supprime.
config.resolver.blockList = /[\\/]node_modules[\\/][^\\/]*_tmp_[^\\/]*[\\/]/;

module.exports = config;
