import { AuthProvider } from './features/auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import './App.css';

export default function App() {
  return <AuthProvider><LoginPage/></AuthProvider>;
}
