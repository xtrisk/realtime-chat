import { useContext } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Chat from './pages/Chat.jsx';
import { AuthContext } from './contexts/AuthContext.jsx';

function App() {
  const { token } = useContext(AuthContext);
  return (
    <Routes>
      <Route
        path="/login"
        element={token ? <Navigate to="/chat" replace /> : <Login />}
      />
      <Route
        path="/register"
        element={token ? <Navigate to="/chat" replace /> : <Register />}
      />
      <Route
        path="/chat"
        element={token ? <Chat /> : <Navigate to="/login" replace />}
      />
      {}
      <Route
        path="*"
        element={<Navigate to={token ? '/chat' : '/login'} replace />}
      />
    </Routes>
  );
}

export default App;