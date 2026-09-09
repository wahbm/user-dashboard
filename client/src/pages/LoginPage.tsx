import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { ApiError, login } from '../api';
import { hasToken, setToken } from '../auth';

interface LoginFormValues {
  username: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hasToken()) {
      navigate('/user/list', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      const data = await login(values.username, values.password);
      setToken(data.token);
      navigate('/user/list', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        message.error(error.message);
      } else {
        message.error('系统异常');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-orb login-orb-one" />
      <div className="login-orb login-orb-two" />
      <Card className="login-card" bordered={false}>
        <div className="login-brand">
          <div className="login-brand-mark"><SafetyCertificateOutlined /></div>
          <Typography.Title level={2}>后台用户管理系统</Typography.Title>
          <Typography.Paragraph>统一维护平台用户信息</Typography.Paragraph>
        </div>
        <Form<LoginFormValues> layout="vertical" size="large" onFinish={handleSubmit}>
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              { pattern: /^[A-Za-z0-9_]{4,20}$/, message: '用户名格式不正确' }
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="请输入管理员账号" autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, max: 20, message: '密码长度为6～20个字符' }
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="请输入登录密码" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading} className="login-submit">
            登录
          </Button>
        </Form>
      </Card>
      <div className="login-footer">后台用户管理系统 · 管理员控制台</div>
    </main>
  );
}
