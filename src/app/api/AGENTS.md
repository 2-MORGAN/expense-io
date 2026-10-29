# src/app/api — routes HTTP

Consignes du dossier, en complément de l'[AGENTS.md](../../../AGENTS.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Une route est une couche fine : authentifier, valider l'entrée, appeler un cas d'usage, formater la réponse. Ni SQL, ni règle métier, ni accès direct au stockage.

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002).

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/app/api` | `src/application`, `src/composition`, `src/domain`, `src/generated`, `src/http`, `src/lib/auth`, `src/lib/authErrors`, `src/lib/errors`, `src/lib/log`, `src/ports`, `src/types`, `src/utils`, `next`, `next-auth` |

<!-- fin : imports permis -->

## Ajouter une opération

1. **Contrat d'abord** : l'opération dans `openapi.yaml` (chemin, schémas, réponses d'erreur), puis `npm run generate:api`. Lire `docs/api/README.md`.
2. Le cas d'usage dans `src/application`, branché dans `src/composition`.
3. Le fichier `route.ts` sous le chemin de l'URL, sur ce modèle :

   ```ts
   export const POST = withApiErrors('/api/manager/expense-notes/[id]/approve', async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
     const session = await auth()
     const actor = requireRole(session, 'manager')
     if (actor instanceof Response) return actor
     const { id } = await params
     validateId(id)

     const note = await decideExpenseNote.execute(id, actor.id, 'approved')
     return Response.json(toExpenseNoteDto(note))
   })
   ```

4. Un scénario E2E avec un ID nouveau (`e2e/AGENTS.md`), la section « API et contrat » de `docs/index.html`, puis `npm run generate:architecture` : le graphe des routes change.

## Exemples à copier

- `src/app/api/manager/expense-notes/[id]/approve/route.ts` : la forme ci-dessus.
- `src/app/api/hr/invitations/route.ts` : corps JSON validé par le contrat, erreur du domaine traduite, `201`.
- `src/app/api/manager/expense-notes/route.ts` : une liste.

## Pièges

- La garde ouvre le handler : avant elle, seulement `const session = await auth()`. `scripts/architecture/routes.ts` la lit dans le code ; une méthode sans garde fait échouer `npm run check`. Une route publique se justifie dans la PR (`PUBLIC_ROUTES`, liste qui ne fait que raccourcir).
- `src/proxy.ts` ne protège pas `/api` : chaque méthode se garde elle-même.
- L'id de l'utilisateur vient de la session (`actor.id`), jamais du corps ni de la query. Un id de ressource venu du client ne prouve rien : le cas d'usage vérifie qu'il est dans le périmètre de l'appelant, sinon 404.
- Ordre des erreurs : 401 ou 403, puis `INVALID_JSON`, puis `VALIDATION_ERROR`, puis les erreurs métier (ADR-004 §6).
- Réponses en anglais avec un `code` stable ; jamais de message interne.
- Ne pas changer un statut, un champ JSON ou un message existant : les E2E les figent (ADR-005 §2).

## Vérifié par

- ESLint (`expense-io/routes-and-ui`) : ni `pg`, ni `src/lib/db`, ni texte SQL.
- `scripts/architecture/architecture.test.ts` : garde de chaque méthode, matrice ci-dessus.
- `npm run check:api` : chaque méthode et chemin présents dans le contrat. Les E2E contrôlent chaque réponse contre le contrat.
