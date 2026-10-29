// Chemins des garde-fous d'agent (guard-frozen, guard-recipe, guard-git),
// comparés en chemins réels : git donne la racine sans lien symbolique, alors
// que l'agent peut passer par un lien (sous macOS, /var → /private/var). Sans
// cela, un fichier du dépôt passait pour un fichier d'ailleurs, et la règle
// était sautée sans rien dire.
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'

/** Chemin sans lien symbolique, même pour un fichier qui n'existe pas encore. */
export function realPath(path) {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(realPath(parent), basename(path))
  }
}

/** `file` depuis la racine `root`, en `/` ; undefined s'il est hors du dépôt. */
export function pathInRepository(root, file) {
  const path = relative(realPath(root), realPath(file)).replaceAll('\\', '/')
  return path === '' || path.startsWith('../') || path === '..' || isAbsolute(path) ? undefined : path
}
