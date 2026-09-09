import { useState } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { App as AntApp, Button, ConfigProvider, Layout, Typography, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { LogoutOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { hasToken, clearToken } from './auth';
import { logout } from './api';
import { LoginPage } from './pages/LoginPage';
import { UserListPage } from './pages/UserListPage';

const { Header, Content } = Layout;

function ProtectedRoute() {
  return hasToken() ? <Outlet /> : <Navigate to="/login" replace />;
}

function AdminLayout() {
  const navigate = useNavigate();
  const [logoutLoading, setLogoutLoading] = useState(false);

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await logout();
    } catch (error) {
      if (!(error instanceof Error && error.name === 'ApiError' && 'code' in error && error.code === 1003)) {
        message.error('退出登录失败');
      }
    } finally {
      clearToken();
      setLogoutLoading(false);
      navigate('/login', { replace: true });
    }
  };

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark"><SafetyCertificateOutlined /></div>
          <div>
            <Typography.Text className="brand-title">后台用户管理系统</Typography.Text>
            <Typography.Text className="brand-subtitle">运营控制台</Typography.Text>
          </div>
        </div>
        <Button
          type="text"
          icon={<LogoutOutlined />}
          className="logout-button"
          loading={logoutLoading}
          onClick={handleLogout}
        >
          退出登录
        </Button>
      </Header>
      <Content className="app-content">
        <Outlet />
      </Content>
    </Layout>
  );
}

export function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorInfo: '#2563eb',
          borderRadius: 10,
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
        },
        components: {
          Layout: { headerBg: '#ffffff' },
          Table: { headerBg: '#f8fafc' },
          Card: { paddingLG: 24 }
        }
      }}
    >
      <AntApp>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AdminLayout />}>
              <Route path="/user/list" element={<UserListPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to={hasToken() ? '/user/list' : '/login'} replace />} />
        </Routes>
      </AntApp>
    </ConfigProvider>
  );
}
