import { App as KApp, Page, Navbar, Block } from 'konsta/react'

export default function App() {
  return (
    <KApp theme="ios" safeAreas>
      <Page>
        <Navbar title="Vault Cards" />
        <Block>Socle prêt.</Block>
      </Page>
    </KApp>
  )
}
