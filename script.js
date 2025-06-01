// 配置参数
const CONFIG = {
    // Cloudflare Worker API地址
    API_URL: 'https://baidupcspay.cursorflow.top',
    // 支付成功后的跳转地址
    RETURN_URL: 'https://gizgy.github.io/BaiduPCSpayment-page/?success=true',
    // WebSocket 连接检查间隔 (毫秒)
    WS_CHECK_INTERVAL: 5000,
    // 订单状态检查间隔 (毫秒)
    ORDER_CHECK_INTERVAL: 3000,
    // 订单状态检查超时 (毫秒)
    ORDER_CHECK_TIMEOUT: 300000, // 5分钟
    // 商户ID
    PID: '1432',
    // 商户密钥
    KEY: 'Kxp7Ja035aOtY2GKvlDvqjZj22AMiBfw'
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
    
    // 添加测试计划（仅在开发环境使用）
    if (urlParams.get('test') === 'true') {
        addTestPlan();
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

// 添加测试计划
function addTestPlan() {
    const plansContainer = document.querySelector('.subscription-plans');
    
    // 创建测试计划元素
    const testPlanElement = document.createElement('div');
    testPlanElement.className = 'plan test-plan';
    testPlanElement.setAttribute('data-plan', 'test');
    
    testPlanElement.innerHTML = `
        <div class="plan-header">
            <h3>测试订阅</h3>
            <div class="price">¥0.1</div>
        </div>
        <div class="plan-features">
            <ul>
                <li><i class="fas fa-check"></i> 有效期1天</li>
                <li><i class="fas fa-check"></i> 测试功能</li>
                <li><i class="fas fa-check"></i> 仅用于测试</li>
            </ul>
        </div>
        <button class="select-plan-btn" data-plan="test">选择</button>
    `;
    
    // 添加到计划容器
    plansContainer.appendChild(testPlanElement);
    
    // 更新按钮事件
    const newBtn = testPlanElement.querySelector('.select-plan-btn');
    newBtn.addEventListener('click', () => {
        selectPlan('test');
    });
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
        // 生成订单号
        const orderNo = generateOrderNo();
        
        // 获取计划金额
        const amount = getPlanAmount(currentPlan);
        
        // 构建易支付请求参数
        const params = {
            pid: CONFIG.PID,                 // 商户ID
            type: 'alipay',                  // 支付类型，指定为支付宝
            out_trade_no: orderNo,           // 商户订单号
            notify_url: CONFIG.RETURN_URL,   // 异步通知地址
            return_url: CONFIG.RETURN_URL,   // 同步跳转地址
            name: `百度上传助手${currentPlan}订阅`, // 商品名称
            money: amount.toFixed(2),        // 金额，保留两位小数
            sign_type: 'MD5',                // 签名类型
            param: JSON.stringify({          // 业务扩展参数
                machineId,
                plan: currentPlan,
                planDays: getPlanDays(currentPlan)
            })
        };
        
        // 生成签名
        params.sign = generateSign(params);
        
        // 构建完整支付URL - 使用submit.php接口
        const payUrl = `${CONFIG.API_URL}/submit.php?${new URLSearchParams(params).toString()}`;
        
        // 打开支付页面
        window.location.href = payUrl;
    } catch (error) {
        console.error('创建订单请求失败:', error);
        showError('网络错误，请重试');
        // 返回选择计划页面
        showSection(elements.paymentSection);
    }
}

// 生成订单号
function generateOrderNo() {
    const now = new Date();
    const timestamp = now.getTime().toString().slice(-10);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `BDU${timestamp}${random}`;
}

// 获取计划对应的金额
function getPlanAmount(plan) {
    const prices = {
        test: 0.1,      // 测试价格
        monthly: 29.9,  // 月度价格
        quarterly: 79.9, // 季度价格
        yearly: 299.9    // 年度价格
    };
    return prices[plan] || prices.monthly;
}

// 获取计划对应的天数
function getPlanDays(plan) {
    const days = {
        test: 1,       // 测试1天
        monthly: 30,   // 月度30天
        quarterly: 90, // 季度90天
        yearly: 365    // 年度365天
    };
    return days[plan] || days.monthly;
}

// 生成签名 - 按照易支付规定的签名算法
function generateSign(params) {
    // 按键名ASCII码从小到大排序
    const keys = Object.keys(params).sort();
    
    // 构建待签名字符串
    let signStr = '';
    for (const key of keys) {
        // sign、sign_type、和空值不参与签名
        if (params[key] && key !== 'sign' && key !== 'sign_type') {
            signStr += `${key}=${params[key]}&`;
        }
    }
    
    // 去掉最后一个&符号
    if (signStr.endsWith('&')) {
        signStr = signStr.slice(0, -1);
    }
    
    // 添加商户密钥
    signStr += CONFIG.KEY;
    
    console.log('待签名字符串:', signStr);
    
    // MD5加密并转小写
    const sign = md5(signStr);
    console.log('生成的签名:', sign);
    return sign;
}

// MD5函数
function md5(string) {
    // 引入外部MD5库
    if (typeof window.md5 === 'function') {
        return window.md5(string);
    }
    
    // 如果没有加载MD5库，尝试使用内联实现
    console.error('MD5库未加载，支付可能会失败');
    
    // 简单的哈希函数(仅用于测试，不是真正的MD5)
    let hash = 0;
    if (string.length === 0) return hash.toString(16);
    for (let i = 0; i < string.length; i++) {
        const char = string.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
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
