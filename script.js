// 配置参数
const CONFIG = {
    // Cloudflare Worker API地址
    API_URL: 'https://baidupcspay.cursorflow.top',
    // 支付成功后的跳转地址
    RETURN_URL: window.location.href.split('?')[0] + '?success=true',
    // WebSocket 连接检查间隔 (毫秒)
    WS_CHECK_INTERVAL: 5000,
    // 订单状态检查间隔 (毫秒)
    ORDER_CHECK_INTERVAL: 3000,
    // 订单状态检查超时 (毫秒)
    ORDER_CHECK_TIMEOUT: 300000, // 5分钟
};

// 全局变量
let webSocket = null;
let machineId = null;
let currentPlan = null;
let orderNo = null;
let orderCheckInterval = null;

// DOM 元素
const elements = {
    connectionStatus: document.getElementById('connection-status'),
    connectionStatusDot: document.querySelector('#connection-status .status-dot'),
    connectionStatusText: document.querySelector('#connection-status .status-text'),
    paymentSection: document.getElementById('payment-section'),
    confirmSection: document.getElementById('confirm-section'),
    loadingSection: document.getElementById('loading-section'),
    successSection: document.getElementById('success-section'),
    confirmPlan: document.getElementById('confirm-plan'),
    confirmPrice: document.getElementById('confirm-price'),
    confirmMachineId: document.getElementById('confirm-machine-id'),
    backToPlanBtn: document.getElementById('back-to-plans-btn'),
    confirmPayBtn: document.getElementById('confirm-pay-btn'),
    loadingText: document.getElementById('loading-text'),
    successPlan: document.getElementById('success-plan'),
    successExpires: document.getElementById('success-expires'),
    selectPlanBtns: document.querySelectorAll('.select-plan-btn')
};

// 初始化页面
document.addEventListener('DOMContentLoaded', () => {
    init();
});

// 初始化函数
async function init() {
    // 获取URL参数
    const urlParams = new URLSearchParams(window.location.search);
    machineId = urlParams.get('machineId');
    
    // 检查是否有machineId参数
    if (!machineId) {
        showError('缺少机器ID参数，请从软件中打开此页面');
        return;
    }
    
    // 检查是否是支付成功返回
    const success = urlParams.get('success');
    if (success === 'true') {
        showSuccessSection();
        return;
    }
    
    // 连接WebSocket
    connectWebSocket();
    
    // 设置选择计划按钮事件
    elements.selectPlanBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const plan = btn.getAttribute('data-plan');
            selectPlan(plan);
        });
    });
    
    // 设置返回按钮事件
    elements.backToPlanBtn.addEventListener('click', () => {
        showSection(elements.paymentSection);
    });
    
    // 设置支付按钮事件
    elements.confirmPayBtn.addEventListener('click', createOrder);
}

// 连接WebSocket
function connectWebSocket() {
    updateConnectionStatus('connecting', '正在连接...');
    
    // 尝试关闭已存在的连接
    if (webSocket) {
        webSocket.close();
    }
    
    try {
        // 创建WebSocket连接
        webSocket = new WebSocket(`${getWebSocketUrl()}?machineId=${machineId}`);
        
        // 连接打开事件
        webSocket.addEventListener('open', () => {
            updateConnectionStatus('connected', '已连接');
            // 发送ping保持连接活跃
            startPingInterval();
        });
        
        // 连接关闭事件
        webSocket.addEventListener('close', () => {
            updateConnectionStatus('disconnected', '已断开');
            // 清除ping定时器
            clearPingInterval();
            // 一段时间后尝试重连
            setTimeout(connectWebSocket, 5000);
        });
        
        // 连接错误事件
        webSocket.addEventListener('error', (error) => {
            console.error('WebSocket错误:', error);
            updateConnectionStatus('disconnected', '连接错误');
        });
        
        // 接收消息事件
        webSocket.addEventListener('message', (event) => {
            handleWebSocketMessage(event.data);
        });
    } catch (error) {
        console.error('创建WebSocket连接失败:', error);
        updateConnectionStatus('disconnected', '连接失败');
    }
}

// 处理WebSocket消息
function handleWebSocketMessage(message) {
    try {
        const data = JSON.parse(message);
        
        console.log('收到WebSocket消息:', data);
        
        // 根据消息类型处理
        switch (data.type) {
            case 'connected':
                // 连接成功确认
                updateConnectionStatus('connected', '已连接');
                break;
                
            case 'activation':
                // 收到激活信息
                handleActivation(data.data);
                break;
                
            case 'pong':
                // 心跳响应，不需要处理
                break;
                
            case 'error':
                // 错误消息
                showError(data.message);
                break;
                
            default:
                console.warn('未知的WebSocket消息类型:', data.type);
        }
    } catch (error) {
        console.error('解析WebSocket消息失败:', error);
    }
}

// 处理激活信息
function handleActivation(data) {
    console.log('收到激活信息:', data);
    
    // 更新成功页面内容
    const planNames = {
        test: '测试订阅',
        monthly: '月度订阅',
        quarterly: '季度订阅',
        yearly: '年度订阅'
    };
    
    elements.successPlan.textContent = planNames[data.plan] || data.plan;
    
    // 格式化过期日期
    const expiresDate = new Date(Date.now() + data.planDays * 24 * 60 * 60 * 1000);
    elements.successExpires.textContent = formatDate(expiresDate);
    
    // 显示成功页面
    showSuccessSection();
    
    // 清除订单检查定时器
    clearOrderCheckInterval();
}

// 选择订阅计划
function selectPlan(plan) {
    // 保存当前选择的计划
    currentPlan = plan;
    
    // 更新确认页面内容
    const planNames = {
        monthly: '月度订阅',
        quarterly: '季度订阅',
        yearly: '年度订阅',
        test: '测试订阅'
    };
    
    const planPrices = {
        monthly: '¥29.9',
        quarterly: '¥79.9',
        yearly: '¥299.9',
        test: '¥0.1'
    };
    
    elements.confirmPlan.textContent = planNames[plan] || plan;
    elements.confirmPrice.textContent = planPrices[plan] || '';
    elements.confirmMachineId.textContent = machineId;
    
    // 显示确认页面
    showSection(elements.confirmSection);
}

// 创建支付订单
async function createOrder() {
    // 显示加载页面
    showSection(elements.loadingSection);
    elements.loadingText.textContent = '正在创建支付订单...';
    
    try {
        // 准备订单数据
        const orderData = {
            plan: currentPlan,
            machineId: machineId,
            returnUrl: CONFIG.RETURN_URL
        };
        
        // 发送创建订单请求
        const response = await fetch(`${CONFIG.API_URL}/create-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderData)
        });
        
        const result = await response.json();
        
        if (result.code === 200) {
            // 保存订单号
            orderNo = result.data.orderNo;
            
            // 启动订单状态检查
            startOrderCheck();
            
            // 打开支付页面
            window.location.href = result.data.payUrl;
        } else {
            showError(`创建订单失败: ${result.message}`);
            // 返回选择计划页面
            showSection(elements.paymentSection);
        }
    } catch (error) {
        console.error('创建订单请求失败:', error);
        showError('网络错误，请重试');
        // 返回选择计划页面
        showSection(elements.paymentSection);
    }
}

// 启动订单状态检查
function startOrderCheck() {
    // 清除可能存在的之前的定时器
    clearOrderCheckInterval();
    
    // 设置开始时间
    const startTime = Date.now();
    
    // 创建新的定时器
    orderCheckInterval = setInterval(async () => {
        // 检查是否超时
        if (Date.now() - startTime > CONFIG.ORDER_CHECK_TIMEOUT) {
            clearOrderCheckInterval();
            elements.loadingText.textContent = '支付超时，请重试';
            setTimeout(() => {
                showSection(elements.paymentSection);
            }, 3000);
            return;
        }
        
        try {
            // 查询订单状态
            const response = await fetch(`${CONFIG.API_URL}/query-order?orderNo=${orderNo}`);
            const result = await response.json();
            
            if (result.code === 200) {
                if (result.data.status === 'paid') {
                    // 订单已支付
                    clearOrderCheckInterval();
                    elements.loadingText.textContent = '支付成功，正在激活...';
                }
            }
        } catch (error) {
            console.error('查询订单状态失败:', error);
        }
    }, CONFIG.ORDER_CHECK_INTERVAL);
}

// 清除订单检查定时器
function clearOrderCheckInterval() {
    if (orderCheckInterval) {
        clearInterval(orderCheckInterval);
        orderCheckInterval = null;
    }
}

// WebSocket心跳
let pingInterval = null;

function startPingInterval() {
    // 清除可能存在的定时器
    clearPingInterval();
    
    // 创建新的定时器
    pingInterval = setInterval(() => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            webSocket.send(JSON.stringify({ type: 'ping' }));
        }
    }, CONFIG.WS_CHECK_INTERVAL);
}

function clearPingInterval() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
}

// 更新连接状态UI
function updateConnectionStatus(status, text) {
    elements.connectionStatusDot.className = 'status-dot ' + status;
    elements.connectionStatusText.textContent = text;
}

// 显示指定页面区域
function showSection(section) {
    // 隐藏所有区域
    elements.paymentSection.classList.add('hidden');
    elements.confirmSection.classList.add('hidden');
    elements.loadingSection.classList.add('hidden');
    elements.successSection.classList.add('hidden');
    
    // 显示指定区域
    section.classList.remove('hidden');
}

// 显示成功页面
function showSuccessSection() {
    // 清除URL参数
    if (window.history && window.history.replaceState) {
        const url = window.location.href.split('?')[0];
        window.history.replaceState({}, document.title, url);
    }
    
    showSection(elements.successSection);
}

// 显示错误消息
function showError(message) {
    alert('错误: ' + message);
}

// 格式化日期
function formatDate(date) {
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// 获取WebSocket URL
function getWebSocketUrl() {
    // 将HTTP(S)转换为WS(S)
    return CONFIG.API_URL.replace(/^http/, 'ws');
} 