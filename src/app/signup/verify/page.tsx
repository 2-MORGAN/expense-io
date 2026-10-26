import Link from 'next/link'

export default function SignupVerifyPage() {
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 pt-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Vérifiez votre boîte mail</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Votre entreprise est créée. Nous vous avons envoyé un lien pour confirmer votre adresse
        email : ouvrez-le, puis connectez-vous. Le lien est valable 24 heures.
      </p>
      <Link href="/login" className="text-sm font-medium text-brand-600 hover:underline">
        Aller à la connexion
      </Link>
    </main>
  )
}
