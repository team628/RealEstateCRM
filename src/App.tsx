import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "@/components/Layout";
import AuthGate from "@/features/auth/AuthGate";
import DashboardPage from "@/features/dashboard/DashboardPage";
import ContactsPage from "@/features/contacts/ContactsPage";
import ContactDetailPage from "@/features/contacts/ContactDetailPage";
import NewLeadPage from "@/features/leads/NewLeadPage";
import TasksPage from "@/features/tasks/TasksPage";
import TransactionsPage from "@/features/transactions/TransactionsPage";
import PropertiesPage from "@/features/properties/PropertiesPage";
import SettingsPage from "@/features/settings/SettingsPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="contacts/:id" element={<ContactDetailPage />} />
            <Route path="leads/new" element={<NewLeadPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="properties" element={<PropertiesPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
