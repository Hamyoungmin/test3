import { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

// 재고 아이템 타입
interface InventoryItem {
  id: number;
  file_name: string;
  row_index: number;
  data: Record<string, unknown>;
  base_stock: number | null;
  alarm_status: boolean;
  // 파싱된 데이터
  itemName: string;
  currentStock: number;
  isLowStock: boolean;
  shortage: number;
}

// 컬럼명 매칭 함수
function findColumnValue(data: Record<string, unknown>, keywords: string[]): unknown {
  for (const key of Object.keys(data)) {
    const normalizedKey = key.toLowerCase().replace(/\s/g, '');
    for (const keyword of keywords) {
      if (normalizedKey.includes(keyword.toLowerCase())) {
        return data[key];
      }
    }
  }
  return null;
}

// 품목명 찾기 (더 유연한 로직)
function findItemName(data: Record<string, unknown>, rowIndex: number): string {
  // 1. 기존 키워드로 찾기
  const keywords = ['품목', '품목명', '상품명', '제품명', '이름', '항목', 'name', 'item', 'product'];
  const keywordMatch = findColumnValue(data, keywords);
  if (keywordMatch && String(keywordMatch).trim()) {
    return String(keywordMatch);
  }
  
  // 2. Column으로 시작하지 않는 첫 번째 문자열 값 찾기
  const keys = Object.keys(data);
  for (const key of keys) {
    // Column으로 시작하는 키는 스킵
    if (key.toLowerCase().startsWith('column')) continue;
    // id 키도 스킵
    if (key.toLowerCase() === 'id') continue;
    
    const value = data[key];
    // 숫자가 아닌 문자열 값 찾기
    if (typeof value === 'string' && value.trim() && isNaN(Number(value.replace(/,/g, '')))) {
      return value;
    }
  }
  
  // 3. 첫 번째 키의 값 사용 (Column 제외)
  for (const key of keys) {
    if (key.toLowerCase().startsWith('column')) continue;
    const value = data[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value);
    }
  }
  
  // 4. 기본값
  return `품목 ${rowIndex + 1}`;
}

export default function HomeScreen() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 새로고침 버튼 회전 애니메이션
  const spinValue = useRef(new Animated.Value(0)).current;
  
  const startSpinAnimation = () => {
    spinValue.setValue(0);
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  };
  
  const stopSpinAnimation = () => {
    spinValue.stopAnimation();
    spinValue.setValue(0);
  };
  
  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // 재고 데이터 불러오기
  const fetchInventory = useCallback(async () => {
    try {
      setError(null);
      
      // base_stock이 설정된 (최종 확정된) 재고만 조회
      const { data, error: dbError } = await supabase
        .from('재고')
        .select('*')
        .not('base_stock', 'is', null)
        .order('file_name')
        .order('row_index');

      if (dbError) {
        throw new Error(dbError.message);
      }

      if (!data || data.length === 0) {
        setInventory([]);
        return;
      }

      // 데이터 파싱
      const parsedData: InventoryItem[] = data.map((row) => {
        const rowData = row.data as Record<string, unknown>;
        
        // 품목명 찾기 (개선된 로직)
        const itemName = findItemName(rowData, row.row_index);
        
        // 현재 재고 찾기
        const currentStock = Number(
          findColumnValue(rowData, ['현재재고', '현재 재고', '재고', '수량', 'stock', 'quantity', 'qty']) 
          || 0
        );
        
        const baseStock = row.base_stock || 0;
        const isLowStock = currentStock < baseStock;
        const shortage = isLowStock ? baseStock - currentStock : 0;

        return {
          ...row,
          itemName,
          currentStock,
          isLowStock,
          shortage,
        };
      });

      // 재고 부족 품목을 상단에 표시
      parsedData.sort((a, b) => {
        if (a.isLowStock && !b.isLowStock) return -1;
        if (!a.isLowStock && b.isLowStock) return 1;
        return 0;
      });

      setInventory(parsedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 불러올 수 없습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    startSpinAnimation();
    await fetchInventory();
    stopSpinAnimation();
  }, [fetchInventory]);

  // 재고 아이템 렌더링
  const renderItem = ({ item }: { item: InventoryItem }) => (
    <View style={[styles.itemCard, item.isLowStock && styles.lowStockCard]}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.itemName}
        </Text>
        {item.isLowStock && (
          <View style={styles.alertBadge}>
            <Ionicons name="warning" size={16} color="#fff" />
            <Text style={styles.alertBadgeText}>재고 부족</Text>
          </View>
        )}
      </View>
      
      <View style={styles.stockInfo}>
        <View style={styles.stockColumn}>
          <Text style={styles.stockLabel}>현재 재고</Text>
          <Text style={[
            styles.stockValue,
            item.isLowStock && styles.lowStockValue
          ]}>
            {item.currentStock.toLocaleString()}개
          </Text>
        </View>
        
        <View style={styles.stockDivider} />
        
        <View style={styles.stockColumn}>
          <Text style={styles.stockLabel}>기준 재고</Text>
          <Text style={styles.stockValue}>
            {(item.base_stock || 0).toLocaleString()}개
          </Text>
        </View>
        
        {item.isLowStock && (
          <>
            <View style={styles.stockDivider} />
            <View style={styles.stockColumn}>
              <Text style={styles.stockLabel}>부족량</Text>
              <Text style={styles.shortageValue}>
                -{item.shortage.toLocaleString()}개
              </Text>
            </View>
          </>
        )}
      </View>
      
      {item.isLowStock && (
        <View style={styles.alertMessage}>
          <Ionicons name="alert-circle" size={18} color="#dc2626" />
          <Text style={styles.alertText}>
            기준 재고보다 {item.shortage}개 부족합니다. 발주가 필요합니다!
          </Text>
        </View>
      )}
      
      <Text style={styles.fileName}>📁 {item.file_name}</Text>
    </View>
  );

  // 통계 정보
  const totalItems = inventory.length;
  const lowStockItems = inventory.filter(item => item.isLowStock).length;

  // AI 재고 요약 생성
  const generateAISummary = useCallback(() => {
    if (inventory.length === 0) {
      return "재고 데이터가 없습니다. 웹에서 재고를 등록해주세요.";
    }

    const lowStockList = inventory.filter(item => item.isLowStock);
    
    if (lowStockList.length === 0) {
      return `총 ${totalItems}개 품목의 재고가 모두 안정적입니다. 현재 발주가 필요한 품목이 없어요! 👍`;
    }

    // 가장 부족한 품목 찾기
    const mostShortage = lowStockList.reduce((prev, current) => 
      (current.shortage > prev.shortage) ? current : prev
    );

    // 총 부족량 계산
    const totalShortage = lowStockList.reduce((sum, item) => sum + item.shortage, 0);

    if (lowStockList.length === 1) {
      return `⚠️ "${mostShortage.itemName}" 품목이 기준 재고보다 ${mostShortage.shortage}개 부족합니다. 발주를 진행해주세요!`;
    }

    return `⚠️ ${lowStockList.length}개 품목에서 재고 부족이 감지되었습니다. 가장 부족한 품목은 "${mostShortage.itemName}"(${mostShortage.shortage}개 부족)이며, 총 ${totalShortage}개의 발주가 필요합니다.`;
  }, [inventory, totalItems]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>재고 데이터 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>재고 현황</Text>
        <TouchableOpacity 
          onPress={onRefresh} 
          style={styles.refreshButton}
          disabled={refreshing}
        >
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Ionicons 
              name="refresh" 
              size={24} 
              color={refreshing ? "#93c5fd" : "#3b82f6"} 
            />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* AI 재고 요약 */}
      <View style={styles.aiSummaryContainer}>
        <View style={styles.aiSummaryHeader}>
          <View style={styles.aiIconContainer}>
            <Ionicons name="sparkles" size={20} color="#fff" />
          </View>
          <Text style={styles.aiSummaryTitle}>오늘의 AI 재고 요약</Text>
        </View>
        <Text style={styles.aiSummaryText}>{generateAISummary()}</Text>
      </View>

      {/* 통계 카드 */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Ionicons name="cube-outline" size={24} color="#3b82f6" />
          <Text style={styles.statNumber}>{totalItems}</Text>
          <Text style={styles.statLabel}>전체 품목</Text>
        </View>
        <View style={[styles.statCard, lowStockItems > 0 && styles.alertStatCard]}>
          <Ionicons 
            name="warning-outline" 
            size={24} 
            color={lowStockItems > 0 ? "#dc2626" : "#9ca3af"} 
          />
          <Text style={[
            styles.statNumber, 
            lowStockItems > 0 && styles.alertStatNumber
          ]}>
            {lowStockItems}
          </Text>
          <Text style={styles.statLabel}>재고 부족</Text>
        </View>
      </View>

      {/* 에러 메시지 */}
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={20} color="#dc2626" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* 재고 리스트 */}
      {inventory.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="file-tray-outline" size={64} color="#d1d5db" />
          <Text style={styles.emptyTitle}>재고 데이터가 없습니다</Text>
          <Text style={styles.emptySubtitle}>
            웹에서 [최종 확정]을 눌러 기준 재고를 설정해주세요
          </Text>
        </View>
      ) : (
        <FlatList
          data={inventory}
          renderItem={renderItem}
          keyExtractor={(item) => `${item.id}`}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#3b82f6']}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  aiSummaryContainer: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e7ff',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  aiSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  aiIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  aiSummaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4338ca',
  },
  aiSummaryText: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 22,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6b7280',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
  },
  refreshButton: {
    padding: 8,
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  alertStatCard: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 4,
  },
  alertStatNumber: {
    color: '#dc2626',
  },
  statLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: '#dc2626',
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 8,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  lowStockCard: {
    borderWidth: 2,
    borderColor: '#fecaca',
    backgroundColor: '#fffbfb',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  itemName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
    marginRight: 8,
  },
  alertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  alertBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  stockInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 12,
  },
  stockColumn: {
    flex: 1,
    alignItems: 'center',
  },
  stockDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#e5e7eb',
  },
  stockLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  stockValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  lowStockValue: {
    color: '#dc2626',
  },
  shortageValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#dc2626',
  },
  alertMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  alertText: {
    flex: 1,
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '500',
  },
  fileName: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 12,
  },
});
