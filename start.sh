#!/bin/bash

# AppOmar WhatsApp Bot - Start Script
# Usage: ./start.sh [api|bot|all]

set -e

export NODE_ENV=production
export API_URL="http://localhost:8000"
export PATH="/usr/bin:$PATH"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging
log_info() {
    echo -e "${BLUE}ℹ️${NC} $1"
}

log_success() {
    echo -e "${GREEN}✅${NC} $1"
}

log_error() {
    echo -e "${RED}❌${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

# Check dependencies
check_dependencies() {
    log_info "جاري التحقق من المتطلبات..."
    
    if ! command -v node &> /dev/null; then
        log_error "Node.js غير مثبت"
        exit 1
    fi
    
    if ! command -v python3 &> /dev/null; then
        log_error "Python3 غير مثبت"
        exit 1
    fi
    
    if ! command -v aria2c &> /dev/null; then
        log_warning "aria2c غير مثبت - قد يؤثر على السرعة"
    fi
    
    log_success "جميع المتطلبات الأساسية موجودة"
}

# Install dependencies
install_deps() {
    log_info "جاري تثبيت المتطلبات..."
    
    if [ -f "package.json" ]; then
        log_info "تثبيت Node dependencies..."
        npm ci --prefer-offline --no-audit || npm install
    fi
    
    if [ -f "requirements.txt" ]; then
        log_info "تثبيت Python dependencies..."
        pip install --break-system-packages -r requirements.txt --quiet
    fi
    
    log_success "تم تثبيت المتطلبات"
}

# Start API Server
start_api() {
    log_info "🚀 جاري بدء خادم API..."
    
    if [ -f "api_server.py" ]; then
        nohup python3 api_server.py > logs/api_server.log 2>&1 &
        API_PID=$!
        echo $API_PID > .api_pid
        
        sleep 3
        
        if curl -s http://localhost:8000/health > /dev/null 2>&1 || [ $? -eq 0 ]; then
            log_success "خادم API بدأ بنجاح (PID: $API_PID)"
        else
            log_warning "قد يكون خادم API قيد البدء..."
        fi
    else
        log_error "لم أجد api_server.py"
        exit 1
    fi
}

# Start WhatsApp Bot
start_bot() {
    log_info "🤖 جاري بدء البوت..."
    
    if [ -f "bot.js" ]; then
        nohup node bot.js > logs/bot.log 2>&1 &
        BOT_PID=$!
        echo $BOT_PID > .bot_pid
        
        log_success "البوت بدأ بنجاح (PID: $BOT_PID)"
        log_info "عرض السجلات: tail -f logs/bot.log"
    else
        log_error "لم أجد bot.js"
        exit 1
    fi
}

# Stop services
stop_services() {
    log_info "جاري إيقاف الخدمات..."
    
    if [ -f ".api_pid" ]; then
        API_PID=$(cat .api_pid)
        if kill $API_PID 2>/dev/null; then
            log_success "تم إيقاف خادم API"
        fi
        rm -f .api_pid
    fi
    
    if [ -f ".bot_pid" ]; then
        BOT_PID=$(cat .bot_pid)
        if kill $BOT_PID 2>/dev/null; then
            log_success "تم إيقاف البوت"
        fi
        rm -f .bot_pid
    fi
}

# Show status
show_status() {
    log_info "حالة الخدمات:"
    
    if [ -f ".api_pid" ]; then
        API_PID=$(cat .api_pid)
        if kill -0 $API_PID 2>/dev/null; then
            log_success "خادم API يعمل (PID: $API_PID)"
        else
            log_error "خادم API متوقف"
        fi
    else
        log_error "خادم API لم يتم بدؤه"
    fi
    
    if [ -f ".bot_pid" ]; then
        BOT_PID=$(cat .bot_pid)
        if kill -0 $BOT_PID 2>/dev/null; then
            log_success "البوت يعمل (PID: $BOT_PID)"
        else
            log_error "البوت متوقف"
        fi
    else
        log_error "البوت لم يتم بدؤه"
    fi
}

# Create logs directory
mkdir -p logs

# Main menu
case "${1:-all}" in
    api)
        check_dependencies
        install_deps
        start_api
        ;;
    bot)
        check_dependencies
        install_deps
        start_bot
        ;;
    all)
        check_dependencies
        install_deps
        start_api
        sleep 2
        start_bot
        log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        log_success "🎉 تم بدء جميع الخدمات بنجاح!"
        log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        log_info "API: http://localhost:8000"
        log_info "سجلات البوت: tail -f logs/bot.log"
        log_info "سجلات API: tail -f logs/api_server.log"
        log_info "لإيقاف الخدمات: ./start.sh stop"
        ;;
    stop)
        stop_services
        ;;
    status)
        show_status
        ;;
    restart)
        stop_services
        sleep 2
        start_api
        sleep 2
        start_bot
        log_success "تم إعادة تشغيل الخدمات"
        ;;
    *)
        echo "استخدام: $0 [api|bot|all|stop|status|restart]"
        echo ""
        echo "أوامر:"
        echo "  api      - بدء خادم API فقط"
        echo "  bot      - بدء البوت فقط"
        echo "  all      - بدء جميع الخدمات (افتراضي)"
        echo "  stop     - إيقاف جميع الخدمات"
        echo "  status   - عرض حالة الخدمات"
        echo "  restart  - إعادة تشغيل الخدمات"
        exit 1
        ;;
esac
