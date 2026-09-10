import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type {
  CreateUserRequest,
  UpdateUserRequest,
  UserListItem,
  UserStatus
} from '@user-dashboard/shared';
import {
  ApiError,
  createUser,
  listUsers,
  resetUserPassword,
  updateUser,
  updateUserStatus
} from '../api';
import { createIdempotencyKey } from '../idempotency';

interface SearchValues {
  username?: string;
  mobile?: string;
  status?: UserStatus;
}

interface CreateFormValues extends CreateUserRequest {}
interface EditFormValues extends UpdateUserRequest {}

const pageSizeOptions = [10, 20, 50] as const;

function showApiError(error: unknown): void {
  if (error instanceof ApiError) {
    message.error(error.message);
    return;
  }
  message.error('系统异常');
}

function userFieldRules() {
  return [
    { required: true, message: '请输入用户名' },
    { pattern: /^[A-Za-z0-9_]{4,20}$/, message: '用户名格式不正确' }
  ];
}

const nameRules = [
  { required: true, message: '请输入姓名' },
  { min: 2, max: 20, message: '姓名长度为2～20个字符' }
];

const mobileRules = [
  { required: true, message: '请输入手机号' },
  { pattern: /^\d{11}$/, message: '手机号格式不正确' }
];

const emailRules = [
  {
    validator: (_rule: unknown, value?: string) => {
      if (!value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('邮箱格式不正确'));
    }
  }
];

const passwordRules = [
  { required: true, message: '请输入初始密码' },
  { min: 6, max: 20, message: '初始密码长度为6～20个字符' }
];

export function UserListPage() {
  const [searchForm] = Form.useForm<SearchValues>();
  const [createForm] = Form.useForm<CreateFormValues>();
  const [editForm] = Form.useForm<EditFormValues>();
  const [rows, setRows] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(10);
  const [filters, setFilters] = useState<SearchValues>({});
  const [loading, setLoading] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const createKeyRef = useRef<string | null>(null);
  const editKeyRef = useRef<string | null>(null);
  const createSubmittingRef = useRef(false);
  const editSubmittingRef = useRef(false);

  const loadData = useCallback(async (nextPage: number, nextPageSize: 10 | 20 | 50, nextFilters: SearchValues) => {
    setLoading(true);
    try {
      const data = await listUsers({
        ...nextFilters,
        page: nextPage,
        pageSize: nextPageSize
      });
      setRows(data.list);
      setTotal(data.total);
      setPage(data.page);
      setPageSize(data.pageSize as 10 | 20 | 50);
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(1, 10, {});
  }, [loadData]);

  const handleSearch = (values: SearchValues) => {
    const nextFilters: SearchValues = {
      username: values.username || undefined,
      mobile: values.mobile || undefined,
      status: values.status
    };
    setFilters(nextFilters);
    void loadData(1, pageSize, nextFilters);
  };

  const handleReset = () => {
    searchForm.resetFields();
    setFilters({});
    void loadData(1, pageSize, {});
  };

  const handlePageChange = (nextPage: number, nextPageSize: number) => {
    const normalizedPageSize = (pageSizeOptions.includes(nextPageSize as 10 | 20 | 50)
      ? nextPageSize
      : 10) as 10 | 20 | 50;
    const targetPage = nextPageSize !== pageSize ? 1 : nextPage;
    void loadData(targetPage, normalizedPageSize, filters);
  };

  const openCreate = () => {
    createForm.resetFields();
    createForm.setFieldsValue({ status: 1 });
    createKeyRef.current = createIdempotencyKey();
    setCreateOpen(true);
  };

  const closeCreate = () => {
    createSubmittingRef.current = false;
    setCreateSubmitting(false);
    createKeyRef.current = null;
    setCreateOpen(false);
    createForm.resetFields();
  };

  const openEdit = (record: UserListItem) => {
    setEditingUser(record);
    editForm.setFieldsValue({ name: record.name, mobile: record.mobile, email: record.email });
    editKeyRef.current = createIdempotencyKey();
    setEditOpen(true);
  };

  const closeEdit = () => {
    editSubmittingRef.current = false;
    setEditSubmitting(false);
    editKeyRef.current = null;
    setEditOpen(false);
    setEditingUser(null);
    editForm.resetFields();
  };

  const handleCreate = async (values: CreateFormValues) => {
    if (createSubmittingRef.current) return;
    createSubmittingRef.current = true;
    setCreateSubmitting(true);
    try {
      const idempotencyKey = createKeyRef.current ?? createIdempotencyKey();
      createKeyRef.current = idempotencyKey;
      await createUser(values, idempotencyKey);
      message.success('新增成功');
      closeCreate();
      await loadData(1, pageSize, filters);
    } catch (error) {
      showApiError(error);
      if (error instanceof ApiError) {
        createKeyRef.current = null;
      }
    } finally {
      createSubmittingRef.current = false;
      setCreateSubmitting(false);
    }
  };

  const handleEdit = async (values: EditFormValues) => {
    if (!editingUser || editSubmittingRef.current) return;
    editSubmittingRef.current = true;
    setEditSubmitting(true);
    try {
      const idempotencyKey = editKeyRef.current ?? createIdempotencyKey();
      editKeyRef.current = idempotencyKey;
      await updateUser(editingUser.id, values, idempotencyKey);
      message.success('修改成功');
      closeEdit();
      await loadData(page, pageSize, filters);
    } catch (error) {
      showApiError(error);
      if (error instanceof ApiError) {
        editKeyRef.current = null;
      }
    } finally {
      editSubmittingRef.current = false;
      setEditSubmitting(false);
    }
  };

  const handleStatusChange = (record: UserListItem) => {
    const nextStatus: UserStatus = record.status === 1 ? 0 : 1;
    const actionText = nextStatus === 1 ? '启用' : '禁用';
    Modal.confirm({
      title: '请确认操作',
      content: `确定要${actionText}该用户吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await updateUserStatus(record.id, { status: nextStatus }, createIdempotencyKey());
          message.success(`${actionText}成功`);
          await loadData(page, pageSize, filters);
        } catch (error) {
          showApiError(error);
        }
      }
    });
  };

  const handleResetPassword = (record: UserListItem) => {
    Modal.confirm({
      title: '请确认操作',
      content: '确定要重置该用户密码吗？',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await resetUserPassword(record.id, createIdempotencyKey());
          message.success('密码重置成功');
        } catch (error) {
          showApiError(error);
        }
      }
    });
  };

  const columns: TableColumnsType<UserListItem> = useMemo(() => [
    { title: '用户ID', dataIndex: 'id', width: 110 },
    { title: '用户名', dataIndex: 'username', width: 150 },
    { title: '姓名', dataIndex: 'name', width: 140 },
    { title: '手机号', dataIndex: 'mobile', width: 150 },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 230,
      render: (email: string) => email || <Typography.Text type="secondary">未填写</Typography.Text>
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: UserStatus) => status === 1
        ? <Tag color="success">启用</Tag>
        : <Tag>禁用</Tag>
    },
    { title: '创建时间', dataIndex: 'createTime', width: 190 },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 230,
      render: (_value, record) => (
        <Space size={2}>
          <Button type="link" onClick={() => openEdit(record)}>编辑</Button>
          <Button type="link" onClick={() => handleStatusChange(record)}>
            {record.status === 1 ? '禁用' : '启用'}
          </Button>
          <Button type="link" onClick={() => handleResetPassword(record)}>重置密码</Button>
        </Space>
      )
    }
  ], [filters, loadData, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="page-container">
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>用户管理</Typography.Title>
          <Typography.Paragraph>维护平台用户资料、状态与登录密码</Typography.Paragraph>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增用户</Button>
      </div>

      <Card className="filter-card" bordered={false}>
        <Form form={searchForm} layout="vertical" onFinish={handleSearch}>
          <Row gutter={16} align="bottom">
            <Col xs={24} sm={8} lg={6}>
              <Form.Item label="用户名" name="username">
                <Input placeholder="支持模糊查询" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8} lg={6}>
              <Form.Item label="手机号" name="mobile">
                <Input placeholder="请输入完整手机号" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8} lg={6}>
              <Form.Item label="状态" name="status">
                <Select
                  allowClear
                  placeholder="全部"
                  options={[{ value: 1, label: '启用' }, { value: 0, label: '禁用' }]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} lg={6}>
              <Form.Item className="filter-actions">
                <Space>
                  <Button type="primary" icon={<SearchOutlined />} htmlType="submit">查询</Button>
                  <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
                </Space>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card className="table-card" bordered={false}>
        <Table<UserListItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1250 }}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无用户数据" /> }}
        />
        <div className="table-footer">
          <Typography.Text type="secondary">共 {total} 条 · 第 {page} / {totalPages} 页</Typography.Text>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            pageSizeOptions={pageSizeOptions.map(String)}
            onChange={handlePageChange}
            showTotal={(value) => `共 ${value} 条`}
          />
        </div>
      </Card>

      <Modal
        title="新增用户"
        open={createOpen}
        onCancel={closeCreate}
        closable={!createSubmitting}
        maskClosable={!createSubmitting}
        footer={null}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate} className="modal-form">
          <Form.Item label="用户名" name="username" rules={userFieldRules()}>
            <Input placeholder="4～20位英文、数字、下划线" />
          </Form.Item>
          <Form.Item label="姓名" name="name" rules={nameRules}>
            <Input placeholder="请输入真实姓名" />
          </Form.Item>
          <Form.Item label="手机号" name="mobile" rules={mobileRules}>
            <Input placeholder="请输入11位手机号" />
          </Form.Item>
          <Form.Item label="邮箱" name="email" rules={emailRules}>
            <Input placeholder="选填，例如 test@example.com" />
          </Form.Item>
          <Form.Item label="初始密码" name="password" rules={passwordRules}>
            <Input.Password placeholder="6～20位" />
          </Form.Item>
          <Form.Item label="状态" name="status" rules={[{ required: true, message: '请选择状态' }]}>
            <Select options={[{ value: 1, label: '启用' }, { value: 0, label: '禁用' }]} />
          </Form.Item>
          <div className="modal-actions">
            <Button onClick={closeCreate} disabled={createSubmitting}>取消</Button>
            <Button type="primary" htmlType="submit" loading={createSubmitting}>确定</Button>
          </div>
        </Form>
      </Modal>

      <Modal
        title="编辑用户"
        open={editOpen}
        onCancel={closeEdit}
        closable={!editSubmitting}
        maskClosable={!editSubmitting}
        footer={null}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit} className="modal-form">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="用户ID"><Input value={editingUser?.id} disabled /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="用户名"><Input value={editingUser?.username} disabled /></Form.Item>
            </Col>
          </Row>
          <Form.Item label="创建时间"><Input value={editingUser?.createTime} disabled /></Form.Item>
          <Form.Item label="姓名" name="name" rules={nameRules}>
            <Input placeholder="请输入真实姓名" />
          </Form.Item>
          <Form.Item label="手机号" name="mobile" rules={mobileRules}>
            <Input placeholder="请输入11位手机号" />
          </Form.Item>
          <Form.Item label="邮箱" name="email" rules={emailRules}>
            <Input placeholder="选填，例如 test@example.com" />
          </Form.Item>
          <div className="modal-actions">
            <Button onClick={closeEdit} disabled={editSubmitting}>取消</Button>
            <Button type="primary" htmlType="submit" loading={editSubmitting}>确定</Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
