#!/usr/bin/env bash
# 快速查看文件metadata的脚本

set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8890}"

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

echo_success() {
    echo -e "${GREEN}✓${NC} $1"
}

echo_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

echo_error() {
    echo -e "${RED}✗${NC} $1"
}

# 检查服务是否运行
check_service() {
    if curl -s -f "${API_BASE}/health" > /dev/null 2>&1; then
        echo_success "RAG服务运行中 (${API_BASE})"
        return 0
    else
        echo_error "RAG服务未运行或无法连接 (${API_BASE})"
        echo_info "请先启动服务: npm run start 或 bash runtime/local_rag_dist/run.sh"
        return 1
    fi
}

# 显示帮助
show_help() {
    cat << EOF
${GREEN}📋 Metadata查看工具${NC}

用法: $0 [命令] [参数]

命令:
  health                  - 检查服务状态
  stats                   - 显示统计信息
  list [limit] [kind] [full] - 列出文件 (full: 显示完整摘要)
  images [full]           - 列出所有图片及其metadata (full: 显示完整描述)
  videos [full]           - 列出所有视频及其metadata (full: 显示完整captions)
  pdfs [full]             - 列出所有PDF及其metadata (full: 显示完整内容)
  pdf-ids                 - 列出所有PDF文件的file id
  chunks <file_id>        - 查看特定PDF文件的所有chunks
  chunk <chunk_id>        - 查看特定chunk的文本内容
  file <file_id>          - 查看特定文件详情
  folders                 - 列出所有文件夹
  search <query>          - 搜索文件

示例:
  $0 health                    # 检查服务状态
  $0 stats                     # 查看统计信息
  $0 images                    # 查看所有图片 (简略)
  $0 images full               # 查看所有图片 (完整描述)
  $0 videos                    # 查看所有视频 (简略)
  $0 videos full               # 查看所有视频 (完整captions)
  $0 pdfs                      # 查看所有PDF (简略)
  $0 pdfs full                 # 查看所有PDF (完整内容/页面描述)
  $0 pdf-ids                   # 列出所有PDF文件的file id
  $0 chunks abc123             # 查看特定PDF的所有chunks（分块详情）
  $0 chunk abc123::page_7_sub_6  # 查看特定chunk的文本内容
  $0 list                      # 列出所有文件 (简略)
  $0 list 20 "" full           # 列出所有文件 (完整摘要)
  $0 file abc123               # 查看特定文件

环境变量:
  API_BASE        - API地址 (默认: http://127.0.0.1:8890)

EOF
}

# 健康检查
cmd_health() {
    echo_info "正在检查服务状态..."
    
    if ! check_service; then
        exit 1
    fi
    
    echo ""
    echo "🏥 服务详情:"
    curl -s "${API_BASE}/health" | jq '.'
}

# 统计信息
cmd_stats() {
    if ! check_service; then
        exit 1
    fi
    
    echo_info "获取统计信息..."
    echo ""
    
    local summary=$(curl -s "${API_BASE}/index/summary")
    
    echo "📊 统计信息:"
    echo "$summary" | jq -r '"  总文件数: \(.indexed_files)"'
    echo "$summary" | jq -r '"  监控文件夹: \(.watched_folders)"'
    echo "$summary" | jq -r '"  总大小: \(.total_size_bytes) 字节"'
    echo "$summary" | jq -r '"  最后索引: \(.last_completed_at // "从未")"'
    
    echo ""
    echo "📂 详细信息:"
    echo "$summary" | jq '.'
}

# 列出文件
cmd_list() {
    if ! check_service; then
        exit 1
    fi
    
    local limit="${1:-20}"
    local kind="${2:-}"
    local full="${3:-false}"
    
    echo_info "获取文件列表 (limit=$limit)..."
    echo ""
    
    local url="${API_BASE}/files?limit=${limit}"
    if [[ -n "$kind" ]]; then
        url="${url}&kind=${kind}"
    fi
    
    local response=$(curl -s "$url")
    local total=$(echo "$response" | jq -r '.total')
    
    echo "📁 文件列表 (总计: $total):"
    echo ""
    
    if [[ "$full" == "full" || "$full" == "--full" ]]; then
        # 完整显示模式
        echo "$response" | jq -r '.files[] | 
            "📄 \(.name)\n" +
            "   ID: \(.id)\n" +
            "   路径: \(.path)\n" +
            "   类型: \(.kind) (\(.extension))\n" +
            "   大小: \(.size) 字节\n" +
            "   修改时间: \(.modifiedAt)\n" +
            (if .summary then "   摘要:\n   \(.summary)\n" else "" end) +
            (if .metadata then "   Metadata Keys: \(.metadata | keys | join(", "))\n" else "" end) +
            "   ---\n"'
    else
        # 简略显示模式
        echo "$response" | jq -r '.files[] | 
            "📄 \(.name)\n" +
            "   ID: \(.id)\n" +
            "   路径: \(.path)\n" +
            "   类型: \(.kind) (\(.extension))\n" +
            "   大小: \(.size) 字节\n" +
            "   修改时间: \(.modifiedAt)\n" +
            (if .summary then "   摘要: \(.summary[:100])...\n" else "" end) +
            (if .metadata then "   Metadata Keys: \(.metadata | keys | join(", "))\n" else "" end) +
            ""'
        echo ""
        echo_info "提示: 使用 '$0 list 20 \"\" full' 查看完整摘要"
    fi
}

# 列出图片
cmd_images() {
    if ! check_service; then
        exit 1
    fi
    
    local full="${1:-false}"
    
    echo_info "获取图片列表..."
    echo ""
    
    local response=$(curl -s "${API_BASE}/files?limit=50")
    local images=$(echo "$response" | jq '[.files[] | select(.kind == "image")]')
    local count=$(echo "$images" | jq 'length')
    
    echo "🖼️  图片文件 (共 $count 张):"
    echo ""
    
    if [[ "$full" == "full" || "$full" == "--full" ]]; then
        # 完整显示模式
        echo "$images" | jq -r '.[] | 
            "📸 \(.name)\n" +
            "   路径: \(.path)\n" +
            "   大小: \(.size) 字节\n" +
            (if .metadata.width and .metadata.height then "   尺寸: \(.metadata.width) x \(.metadata.height)\n" else "" end) +
            (if .metadata.mode then "   模式: \(.metadata.mode)\n" else "" end) +
            (if .summary and (.summary | length > 10) then 
                "   ✅ VLM描述:\n   \(.summary)\n" 
            else 
                "   ❌ VLM描述: 未生成\n" 
            end) +
            "   ---\n"'
    else
        # 简略显示模式
        echo "$images" | jq -r '.[] | 
            "📸 \(.name)\n" +
            "   路径: \(.path)\n" +
            "   大小: \(.size) 字节\n" +
            (if .metadata.width and .metadata.height then "   尺寸: \(.metadata.width) x \(.metadata.height)\n" else "" end) +
            (if .metadata.mode then "   模式: \(.metadata.mode)\n" else "" end) +
            (if .summary and (.summary | length > 10) then 
                "   ✅ VLM描述: \(.summary[:150])...\n" 
            else 
                "   ❌ VLM描述: 未生成\n" 
            end) +
            ""'
        echo ""
        echo_info "提示: 使用 '$0 images full' 查看完整描述"
    fi
}

# 列出视频
cmd_videos() {
    if ! check_service; then
        exit 1
    fi
    
    local full="${1:-false}"
    
    echo_info "获取视频列表..."
    echo ""
    
    local response=$(curl -s "${API_BASE}/files?limit=50")
    local videos=$(echo "$response" | jq '[.files[] | select(.kind == "video")]')
    local count=$(echo "$videos" | jq 'length')
    
    echo "🎬 视频文件 (共 $count 个):"
    echo ""
    
    if [[ "$full" == "full" || "$full" == "--full" ]]; then
        # 完整显示模式
        echo "$videos" | jq -r '.[] | 
            "🎥 \(.name)\n" +
            "   路径: \(.path)\n" +
            "   大小: \(.size) 字节\n" +
            (if .metadata.duration then "   时长: \(.metadata.duration | tonumber | floor) 秒\n" else "" end) +
            (if .metadata.fps then "   FPS: \(.metadata.fps)\n" else "" end) +
            (if .metadata.segments_count then "   片段数: \(.metadata.segments_count)\n" else "" end) +
            (if .metadata.segment_duration then "   片段长度: \(.metadata.segment_duration) 秒/段\n" else "" end) +
            (if .metadata.frames_per_segment then "   每段帧数: \(.metadata.frames_per_segment)\n" else "" end) +
            (if .metadata.video_segment_captions then 
                "   ✅ 视频Captions (\(.metadata.video_segment_captions | length) 个片段):\n" +
                (.metadata.video_segment_captions | to_entries | map("      [\(.key)]: \(.value)") | join("\n")) + "\n"
            else 
                "   ❌ Captions: 未生成\n" 
            end) +
            "   ---\n"'
    else
        # 简略显示模式
        echo "$videos" | jq -r '.[] | 
            "🎥 \(.name)\n" +
            "   路径: \(.path)\n" +
            "   大小: \(.size) 字节\n" +
            (if .metadata.duration then "   时长: \(.metadata.duration | tonumber | floor) 秒\n" else "" end) +
            (if .metadata.fps then "   FPS: \(.metadata.fps)\n" else "" end) +
            (if .metadata.segments_count then "   片段数: \(.metadata.segments_count) 段 x \(.metadata.segment_duration // 30)秒\n" else "" end) +
            (if .metadata.video_segment_captions then 
                "   ✅ Captions: 已生成 (\(.metadata.video_segment_captions | length) 个片段)\n" +
                "      前3个片段:\n" +
                (.metadata.video_segment_captions[:3] | to_entries | map("      \(.value)") | join("\n")) + "\n" +
                (if (.metadata.video_segment_captions | length) > 3 then "      ... 还有 \((.metadata.video_segment_captions | length) - 3) 个片段\n" else "" end)
            else 
                "   ❌ Captions: 未生成\n" 
            end) +
            ""'
        echo ""
        echo_info "提示: 使用 '$0 videos full' 查看所有片段的完整captions"
    fi
}

# 列出PDF文件ID
cmd_pdf_ids() {
    if ! check_service; then
        exit 1
    fi
    
    echo_info "获取PDF文件ID列表..."
    
    # 分页获取所有PDF文件
    local limit=500
    local offset=0
    local all_pdf_ids=""
    
    while true; do
        local response=$(curl -s "${API_BASE}/files?limit=${limit}&offset=${offset}")
        local pdf_ids=$(echo "$response" | jq -r '[.files[] | select(.kind == "document" and .extension == "pdf")] | .[].id' | grep -v '^$')
        
        if [[ -n "$pdf_ids" ]]; then
            if [[ -n "$all_pdf_ids" ]]; then
                all_pdf_ids="${all_pdf_ids}"$'\n'"${pdf_ids}"
            else
                all_pdf_ids="$pdf_ids"
            fi
        fi
        
        # 检查是否还有更多文件
        local total_files=$(echo "$response" | jq -r '.total // 0')
        local current_count=$(echo "$response" | jq -r '.files | length')
        
        if [[ $current_count -lt $limit ]] || [[ $((offset + current_count)) -ge $total_files ]]; then
            break
        fi
        
        offset=$((offset + limit))
    done
    
    if [[ -z "$all_pdf_ids" ]]; then
        echo_warning "未找到PDF文件"
        return
    fi
    
    local total_count=$(echo "$all_pdf_ids" | wc -l | tr -d ' ')
    echo ""
    echo "📚 PDF文件ID (共 $total_count 个):"
    echo ""
    echo "$all_pdf_ids"
}

# 列出PDF
cmd_pdfs() {
    if ! check_service; then
        exit 1
    fi
    
    local full="${1:-false}"
    
    echo_info "获取PDF列表..."
    echo ""
    
    local response=$(curl -s "${API_BASE}/files?limit=100")
    local pdfs=$(echo "$response" | jq '[.files[] | select(.kind == "document" and .extension == "pdf")]')
    local count=$(echo "$pdfs" | jq 'length')
    
    echo "📚 PDF文件 (共 $count 个):"
    echo ""
    
    if [[ "$full" == "full" || "$full" == "--full" ]]; then
        # 完整显示模式
        echo "$pdfs" | jq -r '.[] | 
            "📄 \(.name)\n" +
            "   路径: \(.path)\n" +
            "   大小: \(.size) 字节\n" +
            (if .pageCount then "   页数: \(.pageCount) 页\n" else "" end) +
            (if .metadata.processing_mode then "   处理模式: \(.metadata.processing_mode)\n" else "   处理模式: text (default)\n" end) +
            (if .metadata.source then "   来源: \(.metadata.source)\n" else "" end) +
            (if .summary and (.summary | length > 10) then 
                "   ✅ 摘要:\n   \(.summary)\n" 
            else 
                "   ❌ 摘要: 未生成\n" 
            end) +
            (if .metadata.pdf_page_descriptions then 
                "   ✅ PDF页面描述 (\(.metadata.pdf_page_descriptions | length) 页) [Vision Mode]:\n" +
                (.metadata.pdf_page_descriptions | to_entries | map("      [Page \(.key | tonumber + 1)]: \(.value)") | join("\n")) + "\n"
            elif .metadata.pages then
                "   ℹ️  Text Mode: 使用文本提取 (\(.metadata.pages) 页)\n"
            else 
                "" 
            end) +
            "   ---\n"'
    else
        # 简略显示模式
        echo "$pdfs" | jq -r '.[] | 
            "📄 \(.name)\n" +
            "   路径: \(.path)\n" +
            "   大小: \(.size) 字节\n" +
            (if .pageCount then "   页数: \(.pageCount) 页\n" else "" end) +
            (if .metadata.processing_mode == "vision" then 
                "   🎨 处理模式: Vision (VLM逐页分析)\n" 
            elif .metadata.source == "pdf_vision" then
                "   🎨 处理模式: Vision (VLM逐页分析)\n"
            else 
                "   📝 处理模式: Text (文本提取)\n" 
            end) +
            (if .summary and (.summary | length > 10) then 
                "   ✅ 摘要: \(.summary[:120])...\n" 
            else 
                "   ❌ 摘要: 未生成\n" 
            end) +
            (if .metadata.pdf_page_descriptions then 
                "   ✅ 页面描述: 已生成 (\(.metadata.pdf_page_descriptions | length) 页)\n" +
                "      前2页预览:\n" +
                (.metadata.pdf_page_descriptions[:2] | to_entries | map("      [Page \(.key | tonumber + 1)]: \(.value[:100])...") | join("\n")) + "\n" +
                (if (.metadata.pdf_page_descriptions | length) > 2 then "      ... 还有 \((.metadata.pdf_page_descriptions | length) - 2) 页\n" else "" end)
            elif .metadata.pages then
                "   ℹ️  Text提取: \(.metadata.pages) 页\n"
            else 
                "" 
            end) +
            ""'
        echo ""
        echo_info "提示: 使用 '$0 pdfs full' 查看所有页面的完整描述"
    fi
}

# 查看文件的chunks
cmd_chunks() {
    if ! check_service; then
        exit 1
    fi
    
    local file_id="$1"
    
    if [[ -z "$file_id" ]]; then
        echo_error "请提供file_id"
        echo "用法: $0 chunks <file_id>"
        echo ""
        echo "提示: 先用 'pdfs' 命令获取file_id"
        exit 1
    fi
    
    echo_info "获取文件chunks: $file_id"
    echo ""
    
    # Get file info first
    local file_info=$(curl -s "${API_BASE}/files/${file_id}")
    
    if echo "$file_info" | jq -e '.detail' > /dev/null 2>&1; then
        echo_error "文件不存在: $file_id"
        exit 1
    fi
    
    local file_name=$(echo "$file_info" | jq -r '.name')
    local page_count=$(echo "$file_info" | jq -r '.pageCount // "N/A"')
    
    echo "📄 文件: $file_name"
    echo "📖 页数: $page_count"
    echo ""
    
    # Get chunks via search API (using file_id as a filter)
    # Note: This is a workaround as there's no direct chunks endpoint
    # We use the storage database directly
    
    local db_path="${HOME}/Desktop/local-cocoa/.local_rag/index.sqlite"
    
    if [[ ! -f "$db_path" ]]; then
        echo_error "数据库文件不存在: $db_path"
        exit 1
    fi
    
    echo "🧩 Chunks 详情:"
    echo ""
    
    sqlite3 "$db_path" ".mode list" ".separator '|'" \
        "SELECT id, ordinal, section_path, char_count, 
                json_extract(metadata, '\$.page_number') as page_num,
                json_extract(metadata, '\$.sub_chunk_index') as sub_idx,
                json_extract(metadata, '\$.is_page_complete') as is_complete
         FROM chunks WHERE file_id = '${file_id}' ORDER BY ordinal;" | \
    while IFS='|' read -r chunk_id ordinal section_path char_count page_num sub_idx is_complete; do
        echo "  Chunk #$ordinal:"
        echo "    ID: $chunk_id"
        echo "    Section: $section_path"
        if [[ -n "$page_num" && "$page_num" != "" ]]; then
            echo "    📄 Page: $page_num"
        fi
        if [[ -n "$sub_idx" && "$sub_idx" != "null" && "$sub_idx" != "" ]]; then
            echo "    🔹 Sub-chunk: $sub_idx"
        fi
        if [[ "$is_complete" == "1" ]]; then
            echo "    ✅ Complete page"
        elif [[ "$is_complete" == "0" ]]; then
            echo "    📝 Partial chunk"
        fi
        echo "    📏 Size: $char_count chars"
        echo ""
    done
    
    # Count total chunks
    local chunk_count=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM chunks WHERE file_id = '${file_id}'")
    
    echo ""
    echo_success "总计 $chunk_count 个chunks"
}

# 查看特定文件
cmd_file() {
    if ! check_service; then
        exit 1
    fi
    
    local file_id="$1"
    
    if [[ -z "$file_id" ]]; then
        echo_error "请提供file_id"
        echo "用法: $0 file <file_id>"
        exit 1
    fi
    
    echo_info "获取文件详情: $file_id"
    echo ""
    
    local response=$(curl -s "${API_BASE}/files/${file_id}")
    
    if echo "$response" | jq -e '.detail' > /dev/null 2>&1; then
        echo_error "文件不存在: $file_id"
        exit 1
    fi
    
    echo "📄 文件详情:"
    echo "$response" | jq '.'
}

# 查看chunk文本
cmd_chunk() {
    if ! check_service; then
        exit 1
    fi
    
    local chunk_id="$1"
    
    if [[ -z "$chunk_id" ]]; then
        echo_error "请提供chunk_id"
        echo "用法: $0 chunk <chunk_id>"
        echo ""
        echo "示例: $0 chunk c318bbd6d7371579b96b2ec57f266c736ae6472c::page_7_sub_6"
        exit 1
    fi
    
    echo_info "获取chunk文本: $chunk_id"
    echo ""
    
    # URL编码chunk_id（因为可能包含特殊字符如::）
    local encoded_chunk_id=$(printf '%s' "$chunk_id" | jq -sRr @uri)
    local response=$(curl -s "${API_BASE}/files/chunks/${encoded_chunk_id}")
    
    if echo "$response" | jq -e '.detail' > /dev/null 2>&1; then
        echo_error "Chunk不存在: $chunk_id"
        exit 1
    fi
    
    # 处理可能的snake_case或camelCase字段名
    local file_id=$(echo "$response" | jq -r '.file_id // .fileId // "N/A"')
    local file_name="N/A"
    
    # 尝试获取文件信息以显示文件名
    if [[ "$file_id" != "N/A" ]]; then
        local file_info=$(curl -s "${API_BASE}/files/${file_id}" 2>/dev/null)
        if ! echo "$file_info" | jq -e '.detail' > /dev/null 2>&1; then
            file_name=$(echo "$file_info" | jq -r '.name // "N/A"')
        fi
    fi
    
    echo "📄 文件: $file_name (ID: $file_id)"
    echo "🧩 Chunk ID: $chunk_id"
    echo "📊 字符数: $(echo "$response" | jq -r '.char_count // .charCount // 0')"
    echo "🔢 序号: $(echo "$response" | jq -r '.ordinal // 0')"
    echo ""
    echo "📝 文本内容:"
    echo "────────────────────────────────────────"
    echo "$response" | jq -r '.text // ""'
    echo "────────────────────────────────────────"
    echo ""
    
    # 如果有snippet，也显示
    local snippet=$(echo "$response" | jq -r '.snippet // ""')
    if [[ -n "$snippet" ]] && [[ "$snippet" != "$(echo "$response" | jq -r '.text // ""')" ]]; then
        echo "💬 Snippet:"
        echo "$snippet"
        echo ""
    fi
    
    # 显示metadata（如果有）
    local metadata=$(echo "$response" | jq -r '.metadata // {}')
    if [[ "$metadata" != "{}" ]]; then
        echo "📋 Metadata:"
        echo "$metadata" | jq '.'
    fi
}

# 列出文件夹
cmd_folders() {
    if ! check_service; then
        exit 1
    fi
    
    echo_info "获取文件夹列表..."
    echo ""
    
    local response=$(curl -s "${API_BASE}/folders")
    
    echo "📂 监控的文件夹:"
    echo ""
    
    echo "$response" | jq -r '.folders[] | 
        "📁 \(.label // .path)\n" +
        "   ID: \(.id)\n" +
        "   路径: \(.path)\n" +
        "   状态: \(if .enabled then "✅ 启用" else "❌ 禁用" end)\n" +
        (if .lastIndexedAt then "   最后索引: \(.lastIndexedAt)\n" else "" end) +
        ""'
}

# 搜索
cmd_search() {
    if ! check_service; then
        exit 1
    fi
    
    local query="$1"
    
    if [[ -z "$query" ]]; then
        echo_error "请提供搜索查询"
        echo "用法: $0 search <查询内容>"
        exit 1
    fi
    
    echo_info "搜索: $query"
    echo ""
    
    local response=$(curl -s -G "${API_BASE}/search" --data-urlencode "q=${query}" --data-urlencode "limit=10")
    
    echo "🔍 搜索结果:"
    echo "$response" | jq '.'
}

# 主逻辑
main() {
    local cmd="${1:-help}"
    
    case "$cmd" in
        help|--help|-h)
            show_help
            ;;
        health)
            cmd_health
            ;;
        stats)
            cmd_stats
            ;;
        list)
            shift
            cmd_list "$@"
            ;;
        images)
            shift
            cmd_images "$@"
            ;;
        videos)
            shift
            cmd_videos "$@"
            ;;
        pdfs)
            shift
            cmd_pdfs "$@"
            ;;
        pdf-ids)
            cmd_pdf_ids
            ;;
        chunks)
            shift
            cmd_chunks "$@"
            ;;
        chunk)
            shift
            cmd_chunk "$@"
            ;;
        file)
            shift
            cmd_file "$@"
            ;;
        folders)
            cmd_folders
            ;;
        search)
            shift
            cmd_search "$@"
            ;;
        *)
            echo_error "未知命令: $cmd"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@"

