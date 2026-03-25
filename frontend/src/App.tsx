import { AppProviders } from "@/app/AppProviders";
import { AppRouter } from "@/app/AppRouter";

const App = () => (
  <AppProviders>
    <AppRouter />
  </AppProviders>
);

export default App;
