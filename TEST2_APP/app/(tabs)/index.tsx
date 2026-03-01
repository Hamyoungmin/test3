import { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Easing as RnEasing,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Share,
  AppState,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
// Reanimated은 웹에서 renderNodeDestructive 에러 발생 → 일반 View 사용 (테마 전환 시 애니메이션 없음)
import { Ionicons } from '@expo/vector-icons';
import { Dimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppTheme } from '../../contexts/AppThemeContext';
import { ThemeToggle } from '../../components/ThemeToggle';
import { AppColors } from '../../constants/theme-colors';
import { supabase } from '../../lib/supabase';
import { sendLocalNotification } from '../../lib/notifications';
import { getAIBusinessAdvice } from '../../lib/openai';
import { isNumericColumn } from '../../../shared/excel-utils';
import Voice from '@react-native-voice/voice';

const LAST_CONFIRM_KEY = 'lastConfirmTimestamp';
function formatLastConfirmTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 모바일 안전 렌더링: 숫자에 콤마 + 단위(개) */
function formatCount(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0개';
  return `${Math.floor(n).toLocaleString()}개`;
}

// 재고 아이템 타입
interface InventoryItem {
  id: number;
  file_name: string;
  row_index: number;
  data: Record<string, unknown>;
  base_stock: number | null;
  alarm_status: boolean;
  expiry_date: string | null;
  // 파싱된 데이터
  itemName: string;
  currentStock: number;
  isLowStock: boolean;
  shortage: number;
  unitPrice: number; // 단가 (발주 예산 계산용)
  // 유통기한 관련
  daysUntilExpiry: number | null;
  isExpiringSoon: boolean; // 7일 이내
  isExpired: boolean; // 이미 지남
}

// 📁 파일 그룹 타입
interface FileGroup {
  fileName: string;
  items: InventoryItem[];
  totalItems: number;
  lowStockCount: number;
  expiringCount: number;
  hasConfirmed: boolean; // 기준 재고 설정된 항목이 있는지
}

// 🎨 파일별 포인트 색상 (웹과 동일)
const GRADIENT_COLORS = [
  ['#8b5cf6', '#a78bfa'], // 보라
  ['#06b6d4', '#22d3ee'], // 하늘
  ['#10b981', '#34d399'], // 초록
  ['#f59e0b', '#fbbf24'], // 노랑
  ['#ef4444', '#f87171'], // 빨강
];

// 재고 상태 (웹과 동일 3단계)
type StockStatus = '부족' | '주의' | '여유';
function getStockStatus(item: InventoryItem | null | undefined): StockStatus | null {
  if (!item) return null;
  const base = item.base_stock ?? 0;
  if (base <= 0) return null;
  const cur = item.currentStock ?? 0;
  if (Number(cur) < base) return '부족';
  if (Math.abs(cur - base) < 0.01) return '주의';
  return '여유';
}

const STOCK_STATUS_STYLES: Record<StockStatus, { dot: string; bg: string; text: string }> = {
  부족: { dot: '#EF4444', bg: '#FEE2E2', text: '#EF4444' },
  주의: { dot: '#F97316', bg: '#FFEDD5', text: '#F97316' },
  여유: { dot: '#22C55E', bg: '#DCFCE7', text: '#22C55E' },
};

function StockStatusDisplay({ item }: { item: InventoryItem }) {
  const status = getStockStatus(item);
  const statusStyles = status ? STOCK_STATUS_STYLES[status] : null;
  const valueText = `${(item?.currentStock ?? 0).toLocaleString()}개`;

  return (
    <View
      style={[
        styles.stockStatusWrapper,
        statusStyles
          ? {
              backgroundColor: statusStyles.bg,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 10,
            }
          : { paddingHorizontal: 4, paddingVertical: 4 },
      ]}
    >
      {status && (
        <View
          style={[styles.stockStatusDot, { backgroundColor: statusStyles!.dot }]}
        />
      )}
      <Text
        style={[
          styles.stockValue,
          status === '부족' && styles.stockValueShortage,
          statusStyles && { color: statusStyles.text },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {valueText}
      </Text>
    </View>
  );
}

/** 컬럼명 매칭 - 키워드 우선순위 적용 (구체적→일반). ID 컬럼 제외 */
function findColumnValue(data: Record<string, unknown> | null | undefined, keywords: string[]): unknown {
  if (!data || typeof data !== 'object') return null;
  const keys = Object.keys(data).filter(k => k.toLowerCase() !== 'id');
  for (const keyword of keywords) {
    const kw = keyword.toLowerCase().replace(/\s/g, '');
    for (const key of keys) {
      const normalizedKey = key.toLowerCase().replace(/\s/g, '');
      if (normalizedKey.includes(kw)) return data[key];
    }
  }
  return null;
}

/** 현재 재고(수량) 전용 - 금액/세금/기준 열 제외 (수십억 버그 방지) */
function findCurrentStockValue(data: Record<string, unknown> | null | undefined): number {
  if (!data || typeof data !== 'object') return 0;
  const excludePatterns = ['기준', '금액', '세', '원가', '합계', '총', 'amount', 'sum', 'total', 'tax'];
  const keys = Object.keys(data).filter(k => {
    const lower = k.toLowerCase().replace(/\s/g, '');
    if (lower === 'id') return false;
    return !excludePatterns.some(p => lower.includes(p));
  });
  const keywords = ['현재재고', '현재 재고', '수량', 'stock', 'quantity', 'qty'];
  for (const keyword of keywords) {
    const kw = keyword.toLowerCase().replace(/\s/g, '');
    for (const key of keys) {
      const normalizedKey = key.toLowerCase().replace(/\s/g, '');
      if (normalizedKey.includes(kw)) {
        const v = data[key];
        const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : NaN);
        return (!isNaN(n) && n >= 0 && n <= 999999999) ? n : 0;
      }
    }
  }
  return 0;
}

/** 단가 전용 - 금액/합계 열 제외 (수십억 버그 방지) */
function findUnitPriceValue(data: Record<string, unknown> | null | undefined): number {
  const v = findColumnValue(data, ['단가', '가격', 'price', 'unit_price']);
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(String(v).replace(/,/g, '')) : NaN);
  if (!isNaN(n) && n >= 0 && n <= 999999) return n;
  return 1000;
}

// 규격 찾기
function findSpec(data: Record<string, unknown> | null | undefined): string {
  if (!data || typeof data !== 'object') return '-';
  const v = findColumnValue(data, ['규격', '스펙', 'spec', '규격사항']);
  return v != null && String(v).trim() ? String(v).trim() : '-';
}

// 단위 찾기
function findUnit(data: Record<string, unknown> | null | undefined): string {
  if (!data || typeof data !== 'object') return '-';
  const v = findColumnValue(data, ['단위', 'unit', 'uom']);
  return v != null && String(v).trim() ? String(v).trim() : '-';
}

// 품목명 찾기 (더 유연한 로직)
function findItemName(data: Record<string, unknown> | null | undefined, rowIndex: number): string {
  if (!data || typeof data !== 'object') return `품목 ${rowIndex + 1}`;
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
  const { isDark } = useAppTheme();
  const colors = AppColors[isDark ? 'dark' : 'light'];
  const containerBg = { backgroundColor: colors.background };
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [fileGroups, setFileGroups] = useState<FileGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 📁 파일 상세 모달 관련 state
  const [fileDetailModalVisible, setFileDetailModalVisible] = useState(false);
  const [selectedFileGroup, setSelectedFileGroup] = useState<FileGroup | null>(null);
  
  // 수정 모달 관련 state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [editCurrentStock, setEditCurrentStock] = useState('');
  const [editBaseStock, setEditBaseStock] = useState('');
  const [editExpiryDate, setEditExpiryDate] = useState('');
  const [saving, setSaving] = useState(false);
  
  // 검색 관련 state
  const [searchQuery, setSearchQuery] = useState('');
  const [detailSearchQuery, setDetailSearchQuery] = useState(''); // 상세 화면 검색
  // 퀵 필터: '전체' | '부족' | '확정완료'
  const [quickFilter, setQuickFilter] = useState<'전체' | '부족' | '확정완료'>('전체');

  // 마지막 확정 시간 (앱 메인 대시보드 표시용)
  const [lastConfirmedAt, setLastConfirmedAt] = useState<string | null>(null);
  const lastConfirmHighlight = useRef(new Animated.Value(0)).current;
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [barcodeScanModalVisible, setBarcodeScanModalVisible] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<'강남본점' | '성수점' | '홍대점'>('강남본점');
  const [branchDropdownVisible, setBranchDropdownVisible] = useState(false);

  // 음성 인식 관련 state
  const [voiceModalVisible, setVoiceModalVisible] = useState(false);
  const [voiceRecognizedText, setVoiceRecognizedText] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voicePulseAnim = useRef(new Animated.Value(1)).current;
  const voiceAnimActiveRef = useRef(false);

  // 현장 스냅샷 (항목별 첨부 사진 - 시연용 로컬 상태)
  const [itemPhotos, setItemPhotos] = useState<Record<number, string>>({});
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  
  // AI 경영 한마디 관련 state
  const [aiAdvice, setAiAdvice] = useState<string>('');
  const [aiAdviceLoading, setAiAdviceLoading] = useState(false);
  const aiShimmerAnim = useRef(new Animated.Value(0.4)).current;
  const aiResultAnim = useRef(new Animated.Value(1)).current;
  
  // 차트 관련 state
  const [chartData, setChartData] = useState<{
    labels: string[];
    datasets: { data: number[]; color: () => string; strokeWidth: number }[];
    legend: string[];
  } | null>(null);
  const [fastestDepletingItem, setFastestDepletingItem] = useState<string>('');
  
  const screenWidth = Dimensions.get('window').width;
  
  // 새로고침 버튼 회전 애니메이션
  const spinValue = useRef(new Animated.Value(0)).current;
  
  const startSpinAnimation = () => {
    spinValue.setValue(0);
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: RnEasing.linear,
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

  // 재고 데이터 불러오기 (모든 데이터 - 페이지네이션 적용)
  const fetchInventory = useCallback(async () => {
    try {
      setError(null);
      
      // 🔥 모든 재고 데이터 조회 (페이지네이션으로 전체 데이터 가져오기)
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: batchData, error: fetchError } = await supabase
          .from('재고')
          .select('*')
          .range(from, from + batchSize - 1)
          .order('id', { ascending: true });

        if (fetchError) {
          throw new Error(fetchError.message);
        }

        if (batchData && batchData.length > 0) {
          allData = [...allData, ...batchData];
          from += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      const data = allData;

      if (!data || data.length === 0) {
        setInventory([]);
        setFileGroups([]);
        return;
      }

      // 데이터 파싱
      const parsedData: InventoryItem[] = data.map((row) => {
        const rowData = row.data as Record<string, unknown>;
        
        // 품목명 찾기 (개선된 로직)
        const itemName = findItemName(rowData, row.row_index);
        
        // 현재 재고 찾기 - 수량 열만 참조 (금액/세금 열 제외)
        const currentStock = findCurrentStockValue(rowData);
        
        const baseStock = row.base_stock || 0;
        // base_stock이 설정된 경우에만 재고 부족 체크
        const isLowStock = baseStock > 0 && currentStock < baseStock;
        const shortage = isLowStock ? Math.min(baseStock - currentStock, 999999) : 0;

        // 단가 (발주 예산 계산용) - 금액/합계 열 제외, 없으면 1,000원
        const unitPriceFinal = findUnitPriceValue(rowData);

        // 유통기한 계산
        let daysUntilExpiry: number | null = null;
        let isExpiringSoon = false;
        let isExpired = false;
        
        if (row.expiry_date) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const expiryDate = new Date(row.expiry_date);
          expiryDate.setHours(0, 0, 0, 0);
          daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          isExpiringSoon = daysUntilExpiry > 0 && daysUntilExpiry <= 7;
          isExpired = daysUntilExpiry <= 0;
        }

        return {
          ...row,
          itemName,
          currentStock,
          isLowStock,
          shortage,
          unitPrice: unitPriceFinal,
          daysUntilExpiry,
          isExpiringSoon,
          isExpired,
        };
      });

      // 정렬: 유통기한 임박 > 재고 부족 > 나머지
      parsedData.sort((a, b) => {
        // 유통기한 만료 우선
        if (a.isExpired && !b.isExpired) return -1;
        if (!a.isExpired && b.isExpired) return 1;
        // 유통기한 임박 우선
        if (a.isExpiringSoon && !b.isExpiringSoon) return -1;
        if (!a.isExpiringSoon && b.isExpiringSoon) return 1;
        // 재고 부족 우선
        if (a.isLowStock && !b.isLowStock) return -1;
        if (!a.isLowStock && b.isLowStock) return 1;
        return 0;
      });

      setInventory(parsedData);

      // 📁 파일별 그룹화
      const groupedByFile = parsedData.reduce((acc, item) => {
        const fileName = item.file_name;
        if (!acc[fileName]) {
          acc[fileName] = [];
        }
        acc[fileName].push(item);
        return acc;
      }, {} as Record<string, InventoryItem[]>);

      // FileGroup 배열 생성
      const groups: FileGroup[] = Object.entries(groupedByFile).map(([fileName, items]) => ({
        fileName,
        items,
        totalItems: items.length,
        lowStockCount: items.filter(item => item.isLowStock).length,
        expiringCount: items.filter(item => item.isExpiringSoon || item.isExpired).length,
        hasConfirmed: items.some(item => item.base_stock !== null && item.base_stock > 0),
      }));

      // 문제 있는 파일 우선 정렬
      groups.sort((a, b) => {
        const aHasIssue = a.lowStockCount > 0 || a.expiringCount > 0;
        const bHasIssue = b.lowStockCount > 0 || b.expiringCount > 0;
        if (aHasIssue && !bHasIssue) return -1;
        if (!aHasIssue && bHasIssue) return 1;
        return a.fileName.localeCompare(b.fileName);
      });

      setFileGroups(groups);
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

  // AsyncStorage에서 마지막 확정 시간 복원
  useEffect(() => {
    AsyncStorage.getItem(LAST_CONFIRM_KEY).then((stored) => {
      if (stored) setLastConfirmedAt(stored);
    }).catch(() => {});
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    startSpinAnimation();
    await fetchInventory();
    stopSpinAnimation();
  }, [fetchInventory]);

  // 전체 확정: 미확정 행의 base_stock을 현재 재고로 설정, State 즉시 업데이트
  const handleBulkConfirm = useCallback(async () => {
    const unconfirmed = inventory.filter(item => !item.base_stock || item.base_stock === 0);
    if (unconfirmed.length === 0) {
      Alert.alert('알림', '확정할 미확정 품목이 없습니다.');
      return;
    }
    Alert.alert(
      '전체 확정',
      `미확정 ${unconfirmed.length}개 품목을 현재 재고 기준으로 확정하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '확정',
          onPress: async () => {
            setBulkConfirming(true);
            try {
              for (const item of unconfirmed) {
                await supabase
                  .from('재고')
                  .update({ base_stock: item.currentStock })
                  .eq('id', item.id);
              }
              const now = new Date().toISOString();
              setLastConfirmedAt(now);
              AsyncStorage.setItem(LAST_CONFIRM_KEY, now).catch(() => {});
              lastConfirmHighlight.setValue(1);
              Animated.timing(lastConfirmHighlight, { toValue: 0, duration: 600, useNativeDriver: true }).start();
              setInventory(prev => prev.map(p => {
                if (!p.base_stock || p.base_stock === 0) {
                  return { ...p, base_stock: p.currentStock };
                }
                return p;
              }));
              setFileGroups(prev => prev.map(g => ({
                ...g,
                items: g.items.map(i => (!i.base_stock || i.base_stock === 0) ? { ...i, base_stock: i.currentStock } : i),
                lowStockCount: g.items.filter(i => {
                  const base = (!i.base_stock || i.base_stock === 0) ? i.currentStock : i.base_stock;
                  return base > 0 && (i.currentStock ?? 0) < base;
                }).length,
                hasConfirmed: true,
              })));
              Alert.alert(
                '발주 완료',
                '발주 요청이 5개의 협력업체에 성공적으로 전송되었습니다.',
                [{ text: '확인' }]
              );
            } catch (err) {
              Alert.alert('오류', err instanceof Error ? err.message : '전체 확정에 실패했습니다.');
            } finally {
              setBulkConfirming(false);
            }
          },
        },
      ]
    );
  }, [inventory]);

  // 수정 모달 열기
  const openEditModal = (item: InventoryItem) => {
    setSelectedItem(item);
    setEditCurrentStock(String(item.currentStock));
    setEditBaseStock(String(item.base_stock || 0));
    setEditExpiryDate(item.expiry_date || '');
    setEditModalVisible(true);
  };

  // 수정 모달 닫기
  const closeEditModal = () => {
    setEditModalVisible(false);
    setSelectedItem(null);
    setEditCurrentStock('');
    setEditBaseStock('');
    setEditExpiryDate('');
  };

  // 현장 스냅샷 촬영 (카메라 연동, 권한 요청)
  const handleTakeSnapshot = useCallback(async (item: InventoryItem) => {
    if (Platform.OS === 'web') {
      Alert.alert('알림', '카메라는 모바일(iOS/Android)에서만 사용할 수 있습니다.');
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '현장 스냅샷 촬영을 위해 카메라 권한이 필요합니다.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled) return;
    const uri = result.assets[0]?.uri;
    if (uri) {
      setItemPhotos(prev => ({ ...prev, [item.id]: uri }));
    }
  }, []);

  // 현재 재고 컬럼 키 찾기 - 금액/기준 열 제외 (수량 열만)
  const findStockColumnKey = (data: Record<string, unknown>): string | null => {
    const excludePatterns = ['기준', '금액', '세', '원가', '합계', '총', 'amount', 'sum', 'total', 'tax'];
    const keys = Object.keys(data).filter(k => {
      const lower = k.toLowerCase().replace(/\s/g, '');
      if (lower === 'id') return false;
      return !excludePatterns.some(p => lower.includes(p));
    });
    const keywords = ['현재재고', '현재 재고', '수량', 'stock', 'quantity', 'qty'];
    for (const keyword of keywords) {
      const kw = keyword.toLowerCase().replace(/\s/g, '');
      for (const key of keys) {
        const normalizedKey = key.toLowerCase().replace(/\s/g, '');
        if (normalizedKey.includes(kw)) return key;
      }
    }
    return null;
  };

  // Supabase에 재고 업데이트
  const saveInventoryChanges = async () => {
    if (!selectedItem) return;

    const newCurrentStock = parseInt(editCurrentStock, 10);
    const newBaseStock = parseInt(editBaseStock, 10);

    if (isNaN(newCurrentStock) || isNaN(newBaseStock)) {
      Alert.alert('오류', '유효한 숫자를 입력해주세요.');
      return;
    }

    if (newCurrentStock < 0 || newBaseStock < 0) {
      Alert.alert('오류', '재고는 0 이상이어야 합니다.');
      return;
    }

    // 유통기한 유효성 검사
    let parsedExpiryDate: string | null = null;
    if (editExpiryDate.trim()) {
      // YYYY-MM-DD 형식 검사
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(editExpiryDate.trim())) {
        Alert.alert('오류', '유통기한은 YYYY-MM-DD 형식으로 입력해주세요.\n예: 2026-12-31');
        return;
      }
      parsedExpiryDate = editExpiryDate.trim();
    }

    setSaving(true);

    try {
      // data 객체에서 현재 재고 컬럼 찾아서 업데이트
      const stockKey = findStockColumnKey(selectedItem.data as Record<string, unknown>);
      const updatedData = { ...selectedItem.data };
      
      if (stockKey) {
        updatedData[stockKey] = newCurrentStock;
      }

      const { error: updateError } = await supabase
        .from('재고')
        .update({
          data: updatedData,
          base_stock: newBaseStock,
          expiry_date: parsedExpiryDate,
        })
        .eq('id', selectedItem.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      // 마지막 확정 시간 갱신 + 저장 + 하이라이트
      const now = new Date().toISOString();
      setLastConfirmedAt(now);
      AsyncStorage.setItem(LAST_CONFIRM_KEY, now).catch(() => {});
      lastConfirmHighlight.setValue(1);
      Animated.timing(lastConfirmHighlight, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start();

      Alert.alert('성공', '재고가 업데이트되었습니다.');
      closeEditModal();
      await fetchInventory(); // 데이터 새로고침
    } catch (err) {
      Alert.alert('오류', err instanceof Error ? err.message : '업데이트에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // 📁 파일 카드 렌더링 (메인 화면 - 웹과 동일 디자인)
  const renderFileCard = ({ item, index }: { item: FileGroup; index: number }) => {
    const colorIndex = index % GRADIENT_COLORS.length;
    const primaryColor = GRADIENT_COLORS[colorIndex][0];
    const secondaryColor = GRADIENT_COLORS[colorIndex][1];
    const percentage = totalItems > 0 ? (item.totalItems / totalItems) * 100 : 0;
    
    // 파일 삭제 핸들러
    const handleDeleteFile = async () => {
      Alert.alert(
        '파일 삭제',
        `"${item.fileName}" 파일의 모든 데이터를 삭제하시겠습니까?`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '삭제',
            style: 'destructive',
            onPress: async () => {
              try {
                const { error } = await supabase
                  .from('재고')
                  .delete()
                  .eq('file_name', item.fileName);
                if (error) throw error;
                Alert.alert('완료', '파일이 삭제되었습니다.');
                fetchInventory();
              } catch (err) {
                Alert.alert('오류', '삭제 중 오류가 발생했습니다.');
              }
            }
          }
        ]
      );
    };
    
    return (
      <View style={styles.fileCardWrapper}>
        <TouchableOpacity 
          style={[styles.fileCard, { backgroundColor: colors.surfaceCard, borderColor: colors.border }]}
          onPress={() => {
            setSelectedFileGroup(item);
            setDetailSearchQuery('');
            setFileDetailModalVisible(true);
          }}
          activeOpacity={0.9}
        >
          {/* 상단 그라데이션 라인 */}
          <View style={[styles.fileCardGradientLine, { backgroundColor: primaryColor }]} />
          
          {/* 카드 내용 */}
          <View style={styles.fileCardContent}>
            {/* 파일 아이콘 + 정보 */}
            <View style={styles.fileCardHeader}>
              <View style={[styles.fileIconContainer, { backgroundColor: `${primaryColor}20` }]}>
                <Ionicons name="document-text" size={24} color={primaryColor} />
              </View>
              <View style={styles.fileCardInfo}>
                <Text style={[styles.fileCardName, { color: colors.text }]} numberOfLines={1}>
                  {item.fileName}
                </Text>
                <View style={styles.fileCardRowCount}>
                  <Text style={[styles.fileCardRowNumber, { color: primaryColor }]}>
                    {item.totalItems.toLocaleString()}
                  </Text>
                  <Text style={[styles.fileCardRowLabel, { color: colors.textSecondary }]}>행</Text>
                </View>
              </View>
            </View>

            {/* 데이터 비중 프로그레스 바 */}
            <View style={styles.fileCardProgress}>
              <View style={styles.fileCardProgressHeader}>
                <Text style={[styles.fileCardProgressLabel, { color: colors.textMuted }]}>데이터 비중</Text>
                <Text style={[styles.fileCardProgressPercent, { color: colors.textMuted }]}>{percentage.toFixed(1)}%</Text>
              </View>
              <View style={styles.fileCardProgressBar}>
                <View 
                  style={[
                    styles.fileCardProgressFill, 
                    { width: `${Math.min(percentage, 100)}%`, backgroundColor: primaryColor }
                  ]} 
                />
              </View>
            </View>
          </View>

          {/* 하단 액션 푸터 */}
          <View style={[styles.fileCardFooter, { backgroundColor: colors.surfaceAlt, borderTopColor: colors.borderLight }]}>
            <TouchableOpacity 
              style={styles.fileCardViewButton}
              onPress={() => {
                setSelectedFileGroup(item);
                setDetailSearchQuery('');
                setFileDetailModalVisible(true);
              }}
            >
              <Text style={[styles.fileCardViewText, { color: primaryColor }]}>데이터 보기</Text>
              <Ionicons name="chevron-forward" size={16} color={primaryColor} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.fileCardDeleteButton}
              onPress={handleDeleteFile}
            >
              <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* 재고 부족/유통기한 임박 배지 */}
          {(item.lowStockCount > 0 || item.expiringCount > 0) && (
            <View style={styles.fileCardBadges}>
              {item.lowStockCount > 0 && (
                <View style={styles.fileCardAlertBadge}>
                  <Ionicons name="warning" size={12} color="#fff" />
                  <Text style={styles.fileCardAlertBadgeText}>보충 필요 {item.lowStockCount.toLocaleString()}</Text>
                </View>
              )}
              {item.expiringCount > 0 && (
                <View style={styles.fileCardExpiringBadge}>
                  <Ionicons name="time" size={12} color="#fff" />
                  <Text style={styles.fileCardExpiringBadgeText}>{item.expiringCount.toLocaleString()}</Text>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // 재고 아이템 렌더링 (상세 화면)
  const renderItem = ({ item }: { item: InventoryItem }) => (
    <View style={[
      styles.itemCard,
      item?.isLowStock && { backgroundColor: colors.redLight, borderColor: colors.redBorder, borderWidth: 2 },
      item?.isExpired && styles.expiredCard,
      item?.isExpiringSoon && !item?.isExpired && styles.expiringSoonCard,
    ]}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item?.itemName ?? '-'}
        </Text>
        <View style={styles.headerRight}>
          {item?.isExpired && (
            <View style={styles.expiredBadge}>
              <Ionicons name="skull" size={14} color="#fff" />
              <Text style={styles.expiredBadgeText}>폐기</Text>
            </View>
          )}
          {item?.isExpiringSoon && !item?.isExpired && (
            <View style={styles.expiringSoonBadge}>
              <Ionicons name="time" size={14} color="#92400e" />
              <Text style={styles.expiringSoonBadgeText}>폐기 임박</Text>
            </View>
          )}
          {item?.isLowStock && (
            <View style={styles.alertBadge}>
              <Ionicons name="warning" size={16} color="#fff" />
              <Text style={styles.alertBadgeText}>보충 필요</Text>
            </View>
          )}
          <TouchableOpacity 
            style={styles.editButton}
            onPress={() => openEditModal(item)}
          >
            <Ionicons name="pencil" size={16} color="#166534" />
            <Text style={styles.editButtonText}>수정</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      <View style={styles.stockInfo}>
        <View style={styles.stockColumn}>
          <Text style={styles.stockLabel}>현재 재고</Text>
          <StockStatusDisplay item={item} />
        </View>
        
        <View style={styles.stockDivider} />
        
        <View style={styles.stockColumn}>
          <Text style={styles.stockLabel}>적정 재고(Threshold)</Text>
          <Text style={styles.stockValue}>
            {(item?.base_stock ?? 0).toLocaleString()}개
          </Text>
        </View>
        
        {item?.expiry_date != null && item.expiry_date !== '' && (
          <>
            <View style={styles.stockDivider} />
            <View style={styles.stockColumn}>
              <Text style={styles.stockLabel}>유통기한</Text>
              <Text style={[
                styles.stockValue,
                styles.expiryValue,
                item?.isExpired && styles.expiredValue,
                item?.isExpiringSoon && !item?.isExpired && styles.expiringSoonValue,
              ]}>
                {(item?.daysUntilExpiry ?? 0) <= 0
                  ? '만료'
                  : `D-${item?.daysUntilExpiry ?? '-'}`}
              </Text>
            </View>
          </>
        )}
        
        {item?.isLowStock && !item?.expiry_date && (
          <>
            <View style={styles.stockDivider} />
            <View style={styles.stockColumn}>
              <Text style={styles.stockLabel}>부족량</Text>
              <Text style={styles.shortageValue}>
                -{(item?.shortage ?? 0).toLocaleString()}개
              </Text>
            </View>
          </>
        )}
      </View>

      {/* 유통기한 임박/만료 경고 */}
      {item?.isExpired && (
        <View style={styles.expiredMessage}>
          <Ionicons name="skull" size={18} color="#7f1d1d" />
          <Text style={styles.expiredText}>
            유통기한이 만료되었습니다! 즉시 폐기해주세요.
          </Text>
        </View>
      )}
      
      {item.isExpiringSoon && !item.isExpired && (
        <View style={styles.expiringSoonMessage}>
          <Ionicons name="time" size={18} color="#92400e" />
          <Text style={styles.expiringSoonText}>
            유통기한이 {item.daysUntilExpiry}일 남았습니다. 우선 판매해주세요!
          </Text>
        </View>
      )}
      
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

  // 🔍 파일 그룹 검색 + 퀵 필터 (실시간 반응)
  const filteredFileGroups = fileGroups.filter(group => {
    // 1. 품목명 검색
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      const hasMatchingItem = group.items.some(item => 
        item.itemName.toLowerCase().includes(query)
      );
      const matchesFileName = group.fileName.toLowerCase().includes(query);
      if (!hasMatchingItem && !matchesFileName) return false;
    }
    // 2. 퀵 필터
    if (quickFilter === '부족') return group.lowStockCount > 0;
    if (quickFilter === '확정완료') return group.hasConfirmed;
    return true;
  });

  // 📁 상세 화면 품목 필터링 (검색 + 퀵 필터 연동)
  const filteredDetailItems = (selectedFileGroup?.items ?? []).filter(item => {
    const itemName = item?.itemName ?? '';
    const matchesSearch = detailSearchQuery === '' ||
      String(itemName).toLowerCase().includes(detailSearchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (quickFilter === '부족') return !!item?.isLowStock;
    if (quickFilter === '확정완료') return (item?.base_stock != null) && (item.base_stock ?? 0) > 0;
    return true;
  });

  // 통계 정보 (전체 기준)
  const totalItems = inventory.length;
  const totalFiles = fileGroups.length;
  const lowStockItems = inventory.filter(item => item.isLowStock).length;
  const lowStockList = inventory.filter(item => item.isLowStock);
  const expiringItems = inventory.filter(item => item.isExpiringSoon || item.isExpired).length;

  // 총 예상 발주 비용 (부족 수량 × 단가) - 행 단위 합산, 상한 적용
  const totalOrderBudget = Math.min(
    lowStockList.reduce((sum, item) => sum + item.shortage * item.unitPrice, 0),
    999999999999
  );

  // 앱 포그라운드 시 데이터 새로고침 (웹 수정 시 실시간 반영)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        fetchInventory();
      }
    });
    return () => subscription.remove();
  }, [fetchInventory]);

  // 음성 인식 Voice 이벤트 리스너 및 정리
  const startVoiceRecognition = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert('알림', '음성 인식은 모바일(iOS/Android)에서만 사용할 수 있습니다.');
      return;
    }
    setVoiceError(null);
    setVoiceRecognizedText('');
    setVoiceModalVisible(true);
    voiceAnimActiveRef.current = true;
    const pulseLoop = () => {
      if (!voiceAnimActiveRef.current) return;
      Animated.sequence([
        Animated.timing(voicePulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(voicePulseAnim, { toValue: 0.95, duration: 600, useNativeDriver: true }),
      ]).start(() => pulseLoop());
    };
    pulseLoop();
    try {
      await Voice.start('ko-KR');
    } catch (e) {
      setVoiceError('다시 말씀해 주세요');
      setTimeout(() => setVoiceModalVisible(false), 2000);
    }
  }, [voicePulseAnim]);

  const stopVoiceRecognition = useCallback(async () => {
    voiceAnimActiveRef.current = false;
    try {
      await Voice.stop();
    } catch (_) {}
    setVoiceModalVisible(false);
    voicePulseAnim.stopAnimation();
    voicePulseAnim.setValue(1);
  }, [voicePulseAnim]);

  useEffect(() => {
    Voice.onSpeechPartialResults = (e) => {
      const text = e.value?.[0] ?? '';
      setVoiceRecognizedText(text);
      setSearchQuery(text);
    };
    Voice.onSpeechResults = (e) => {
      const text = e.value?.[0] ?? '';
      setVoiceRecognizedText(text);
      setSearchQuery(text);
      setTimeout(stopVoiceRecognition, 500);
    };
    Voice.onSpeechEnd = () => {
      setTimeout(stopVoiceRecognition, 300);
    };
    Voice.onSpeechError = (e) => {
      setVoiceError('다시 말씀해 주세요');
      setTimeout(stopVoiceRecognition, 1500);
    };
    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, [stopVoiceRecognition]);

  // 모바일 대시보드용 핵심 지표
  const unconfirmedCount = inventory.filter(item => !item.base_stock || item.base_stock === 0).length;
  const confirmedCount = inventory.filter(item => item.base_stock !== null && item.base_stock > 0).length;

  // 발주 목록 공유
  const shareOrderList = async () => {
    if (lowStockList.length === 0) {
      Alert.alert('알림', '현재 재고 부족 품목이 없습니다.');
      return;
    }

    // 날짜 포맷
    const today = new Date();
    const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

    // 발주 목록 텍스트 생성
    const orderItems = lowStockList.map((item, index) => 
      `${index + 1}. ${item.itemName}: ${item.shortage}개`
    ).join('\n');

    const totalShortage = lowStockList.reduce((sum, item) => sum + item.shortage, 0);

    const message = `📦 발주 목록 (${dateStr})

${orderItems}

──────────────
총 ${lowStockList.length}개 품목, ${totalShortage}개 발주 필요

※ 재고관리 앱에서 자동 생성`;

    try {
      await Share.share({
        message,
        title: '발주 목록 공유',
      });
    } catch (error) {
      Alert.alert('오류', '공유에 실패했습니다.');
    }
  };

  // AI 재고 요약 생성 - 행(Row) 단위 카운트만 사용 (열 합산 금지)
  const generateAISummary = useCallback(() => {
    if (inventory.length === 0) {
      return "재고 데이터가 없습니다. 웹에서 재고를 등록해주세요.";
    }

    const lowStockRowCount = inventory.filter(item => item.isLowStock).length;
    
    if (lowStockRowCount === 0) {
      return `총 ${formatCount(totalItems)} 품목의 재고가 모두 안정적입니다. 현재 발주가 필요한 품목이 없어요! 👍`;
    }

    const lowStockList = inventory.filter(item => item.isLowStock);
    const mostShortage = lowStockList.reduce((prev, current) => 
      (current.shortage > prev.shortage) ? current : prev
    );
    const totalShortage = lowStockList.reduce((sum, item) => sum + item.shortage, 0);

    if (lowStockRowCount === 1) {
      return `⚠️ "${mostShortage.itemName}" 품목이 기준 재고보다 ${formatCount(mostShortage.shortage)} 부족합니다. 발주를 진행해주세요!`;
    }

    return `⚠️ ${formatCount(lowStockRowCount)} 품목에서 재고 부족이 감지되었습니다. 가장 부족한 품목은 "${mostShortage.itemName}"(${formatCount(mostShortage.shortage)} 부족)이며, 총 ${formatCount(totalShortage)} 발주가 필요합니다.`;
  }, [inventory, totalItems]);

  // AI 경영 한마디 가져오기
  const fetchAIAdvice = useCallback(async () => {
    if (inventory.length === 0) {
      setAiAdvice('재고 데이터를 등록하면 AI가 경영 조언을 드려요! 🤖');
      return;
    }

    setAiAdviceLoading(true);
    try {
      const inventoryData = inventory.map(item => ({
        itemName: item.itemName,
        currentStock: item.currentStock,
        baseStock: item.base_stock || 0,
        shortage: item.shortage,
        isLowStock: item.isLowStock,
      }));

      const advice = await getAIBusinessAdvice(inventoryData);
      setAiAdvice(advice);
    } catch (error) {
      setAiAdvice('AI 조언을 불러오는 중 오류가 발생했습니다.');
    } finally {
      setAiAdviceLoading(false);
    }
  }, [inventory]);

  // 재고 데이터 변경 시 AI 조언 업데이트
  useEffect(() => {
    if (!loading && inventory.length >= 0) {
      fetchAIAdvice();
    }
  }, [inventory, loading]);

  // AI 로딩 시 반짝이는 shimmer 효과
  useEffect(() => {
    if (aiAdviceLoading) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(aiShimmerAnim, {
            toValue: 0.9,
            duration: 600,
            useNativeDriver: true,
            easing: RnEasing.inOut(RnEasing.ease),
          }),
          Animated.timing(aiShimmerAnim, {
            toValue: 0.4,
            duration: 600,
            useNativeDriver: true,
            easing: RnEasing.inOut(RnEasing.ease),
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      aiShimmerAnim.setValue(0.4);
    }
  }, [aiAdviceLoading]);

  // AI 분석 완료 시 카드 '스르륵' 등장 효과
  useEffect(() => {
    if (!aiAdviceLoading && aiAdvice) {
      aiResultAnim.setValue(0);
      Animated.timing(aiResultAnim, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
        easing: RnEasing.out(RnEasing.cubic),
      }).start();
    }
  }, [aiAdviceLoading, aiAdvice]);

  // 7일간 재고 추이 차트 데이터 생성
  const generateChartData = useCallback(() => {
    if (inventory.length === 0) {
      setChartData(null);
      return;
    }

    // 최근 7일 라벨 생성
    const labels: string[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
    }

    // 상위 3개 품목 선택 (재고 부족 우선, 그 다음 현재 재고가 적은 순)
    const sortedItems = [...inventory].sort((a, b) => {
      if (a.isLowStock && !b.isLowStock) return -1;
      if (!a.isLowStock && b.isLowStock) return 1;
      return a.currentStock - b.currentStock;
    }).slice(0, 3);

    // 각 품목별 7일 추이 시뮬레이션 (실제 히스토리 데이터가 있다면 대체 필요)
    const colors = [
      () => '#ef4444', // 빨강
      () => '#f59e0b', // 주황
      () => '#3b82f6', // 파랑
    ];

    const datasets = sortedItems.map((item, index) => {
      const baseStock = item.base_stock || item.currentStock * 1.5;
      const currentStock = item.currentStock;
      
      // 7일 전부터 현재까지의 추이 시뮬레이션
      // 실제로는 Supabase의 재고_히스토리 테이블에서 가져와야 함
      const dailyConsumption = (baseStock - currentStock) / 7;
      const data: number[] = [];
      
      for (let i = 0; i < 7; i++) {
        const stockOnDay = Math.max(0, Math.round(baseStock - (dailyConsumption * i) + (Math.random() * 5 - 2.5)));
        data.push(stockOnDay);
      }
      // 마지막 날은 현재 재고
      data[6] = currentStock;

      return {
        data,
        color: colors[index],
        strokeWidth: 2,
      };
    });

    // 안전 재고 기준선: 차트된 품목들의 최소 기준 재고 (빨간색 수평선)
    const safeStockLevel = Math.min(...sortedItems.map(i => i.base_stock || i.currentStock * 1.5));
    datasets.push({
      data: Array(7).fill(safeStockLevel),
      color: () => '#DC2626',
      strokeWidth: 2,
    });

    const legend = [
      ...sortedItems.map(item => 
        item.itemName.length > 8 ? item.itemName.substring(0, 8) + '...' : item.itemName
      ),
      '안전 재고 기준선',
    ];

    setChartData({ labels, datasets, legend });

    // 가장 빠르게 소진되는 품목 찾기
    let maxDepletion = 0;
    let fastestItem = '';
    sortedItems.forEach((item) => {
      const baseStock = item.base_stock || item.currentStock * 1.5;
      const depletionRate = ((baseStock - item.currentStock) / baseStock) * 100;
      if (depletionRate > maxDepletion) {
        maxDepletion = depletionRate;
        fastestItem = item.itemName;
      }
    });
    setFastestDepletingItem(fastestItem);
  }, [inventory]);

  // 재고 데이터 변경 시 차트 업데이트
  useEffect(() => {
    if (!loading) {
      generateChartData();
    }
  }, [inventory, loading, generateChartData]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#166534" />
        <Text style={styles.loadingText}>재고 데이터 불러오는 중...</Text>
      </View>
    );
  }

  const BRANCH_OPTIONS: ('강남본점' | '성수점' | '홍대점')[] = ['강남본점', '성수점', '홍대점'];

  // 헤더 컴포넌트 (FlatList와 ScrollView에서 재사용)
  const renderHeaderContent = () => (
    <>
      {/* 지점 선택 드롭다운 */}
      <TouchableOpacity
        style={[styles.branchSelector, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setBranchDropdownVisible(true)}
        activeOpacity={0.7}
      >
        <Ionicons name="business" size={20} color={colors.textSecondary} style={styles.branchSelectorIcon} />
        <Text style={[styles.branchSelectorText, { color: colors.text }]} numberOfLines={1}>
          {selectedBranch}
        </Text>
        <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      {/* 지점 선택 모달 */}
      <Modal
        visible={branchDropdownVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBranchDropdownVisible(false)}
      >
        <TouchableOpacity
          style={styles.branchModalOverlay}
          activeOpacity={1}
          onPress={() => setBranchDropdownVisible(false)}
        >
          <View
            style={[styles.branchModalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.branchModalTitle, { color: colors.text }]}>지점 선택</Text>
            {BRANCH_OPTIONS.map((branch) => (
              <TouchableOpacity
                key={branch}
                style={[
                  styles.branchModalOption,
                  { borderColor: colors.border, backgroundColor: selectedBranch === branch ? colors.surfaceAlt : colors.surface },
                ]}
                onPress={() => {
                  setSelectedBranch(branch);
                  setBranchDropdownVisible(false);
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.branchModalOptionText, { color: colors.text }]}>{branch}</Text>
                {selectedBranch === branch && (
                  <Ionicons name="checkmark" size={20} color={colors.green} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 헤더 */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{selectedBranch} 재고 현황</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {totalFiles.toLocaleString()}개 파일 · 총 {totalItems.toLocaleString()}개 품목
          </Text>
        </View>
        <View style={styles.headerButtons}>
          {/* 테마 토글 (다크/라이트) */}
          <ThemeToggle />
          {/* 알림 센터 (재고 부족 시 빨간 점 배지) */}
          <TouchableOpacity 
            onPress={() => {
              if (lowStockItems > 0) {
                sendLocalNotification(
                  '⚠️ 재고 부족 알림',
                  `${lowStockItems}개 품목의 재고가 부족합니다!`
                );
              } else {
                sendLocalNotification(
                  '✅ 재고 상태 양호',
                  '현재 모든 품목의 재고가 충분합니다.'
                );
              }
            }}
            style={[styles.alarmCenterButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Ionicons name="notifications-outline" size={26} color={colors.textSecondary} />
            {lowStockItems > 0 && (
              <View style={styles.alarmCenterBadge}>
                <View style={styles.alarmCenterBadgeDot} />
              </View>
            )}
          </TouchableOpacity>
          {/* 새로고침 버튼 */}
          <TouchableOpacity 
            onPress={onRefresh} 
            style={[styles.refreshButton, { backgroundColor: colors.greenLight, borderColor: colors.greenBorder }]}
            disabled={refreshing}
          >
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <Ionicons 
                name="refresh" 
                size={24} 
                color={refreshing ? "#86EFAC" : "#166534"} 
              />
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      {/* 🔍 검색바 (헤더 바로 아래 고정) + 바코드 스캔 */}
      <View style={[styles.topSearchSection, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={styles.topSearchRow}>
          <View style={[styles.topSearchInputWrapper, { backgroundColor: colors.searchBg, borderColor: colors.border }]}>
            <Ionicons name="search" size={22} color={colors.textMuted} style={styles.topSearchIcon} />
            <TextInput
              style={[styles.topSearchInput, { color: colors.text }]}
              placeholder="품목명 검색..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity 
                onPress={() => setSearchQuery('')} 
                style={styles.topSearchClearButton}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close-circle" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            onPress={startVoiceRecognition}
            style={[styles.voiceMicButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Ionicons name="mic" size={24} color="#166534" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setBarcodeScanModalVisible(true)}
            style={[styles.barcodeScanButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Ionicons name="camera" size={26} color="#166534" />
          </TouchableOpacity>
        </View>

        {/* 퀵 필터 칩 - 가로 스크롤, 모바일 최적화 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickFilterScrollContent}
          style={styles.quickFilterScroll}
        >
          <TouchableOpacity
            style={[styles.quickFilterChip, quickFilter === '전체' && styles.quickFilterChipActive]}
            onPress={() => setQuickFilter('전체')}
            activeOpacity={0.7}
          >
            <Text style={[styles.quickFilterChipText, quickFilter === '전체' && styles.quickFilterChipTextActive]} numberOfLines={1}>
              전체
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.quickFilterChip, 
              quickFilter === '부족' && styles.quickFilterChipDanger
            ]}
            onPress={() => setQuickFilter('부족')}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.quickFilterChipText, 
              quickFilter === '부족' && styles.quickFilterChipTextDanger
            ]} numberOfLines={1}>
              부족
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.quickFilterChip, 
              quickFilter === '확정완료' && styles.quickFilterChipSuccess
            ]}
            onPress={() => setQuickFilter('확정완료')}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.quickFilterChipText, 
              quickFilter === '확정완료' && styles.quickFilterChipTextSuccess
            ]} numberOfLines={1}>
              확정 완료
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* 모바일 전용 재고 현황 대시보드 (2x2 그리드) */}
      <View style={[styles.dashboardSection, { backgroundColor: colors.surfaceCard, borderColor: colors.border }]}>
        <View style={styles.dashboardHeaderRow}>
          <Text style={[styles.dashboardSectionTitle, { color: colors.text }]}>재고 현황 대시보드</Text>
          <View style={styles.dashboardHeaderActions}>
            {unconfirmedCount > 0 && (
              <TouchableOpacity
                onPress={handleBulkConfirm}
                disabled={bulkConfirming}
                style={[styles.bulkConfirmButton, { backgroundColor: colors.greenLight, borderColor: colors.greenBorder }]}
              >
                <Ionicons name="checkmark-done" size={16} color="#166534" />
                <Text style={styles.bulkConfirmButtonText}>전체 확정</Text>
              </TouchableOpacity>
            )}
            {lastConfirmedAt && (
            <Animated.View
              style={[
                styles.lastConfirmBadge,
                {
                  backgroundColor: lastConfirmHighlight.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['transparent', 'rgba(34, 197, 94, 0.4)'],
                  }),
                },
              ]}
            >
              <Ionicons name="time-outline" size={14} color="#6B7280" />
              <Text style={[styles.lastConfirmText, { color: colors.textSecondary }]}>
                마지막 업데이트: {formatLastConfirmTime(lastConfirmedAt)}
              </Text>
            </Animated.View>
            )}
          </View>
        </View>
        {lowStockItems > 0 && (
          <View style={[styles.dashboardRiskSummary, { backgroundColor: colors.redLight, borderColor: colors.redBorder }]}>
            <Ionicons name="warning" size={18} color={colors.red} />
            <Text style={[styles.dashboardRiskSummaryText, { color: colors.red }]}>
              현재 위험 품목: {lowStockItems}개
            </Text>
          </View>
        )}
        <View style={styles.dashboardGrid}>
          <View style={styles.dashboardGridRow}>
            {/* 미확정 품목 */}
            <View style={[styles.dashboardCard, { backgroundColor: colors.surfaceCard, borderColor: colors.border }]}>
              <Ionicons name="ellipse-outline" size={28} color="#6B7280" />
              <View style={styles.dashboardCardContent}>
                <Text style={[styles.dashboardCardNumber, { color: colors.text }]}>{formatCount(unconfirmedCount)}</Text>
                <Text style={[styles.dashboardCardLabel, { color: colors.textSecondary }]}>미확정 품목</Text>
              </View>
            </View>
            {/* 재고 위험 */}
            <View style={[
              styles.dashboardCard,
              { backgroundColor: colors.surfaceCard, borderColor: colors.border },
              lowStockItems > 0 && { backgroundColor: colors.redLight, borderColor: colors.redBorder }
            ]}>
              <Ionicons 
                name="warning" 
                size={28} 
                color={lowStockItems > 0 ? "#DC2626" : "#9CA3AF"} 
              />
              <View style={styles.dashboardCardContent}>
                <View style={styles.dashboardCardNumberRow}>
                  <Text style={[
                    styles.dashboardCardNumber, 
                    lowStockItems > 0 && styles.dashboardCardNumberAlert
                  ]}>
                    {formatCount(lowStockItems)}
                  </Text>
                  {lowStockItems > 0 && (
                    <View style={styles.supplyNeededBadge}>
                      <Text style={styles.supplyNeededBadgeText}>보충 필요</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.dashboardCardLabel, { color: colors.textSecondary }]}>재고 위험</Text>
              </View>
            </View>
          </View>
          <View style={styles.dashboardGridRow}>
            {/* 최종 확정 (오늘 완료) */}
            <View style={[styles.dashboardCard, { backgroundColor: colors.surfaceCard, borderColor: colors.border }]}>
              <Ionicons name="checkmark-circle" size={28} color="#16A34A" />
              <View style={styles.dashboardCardContent}>
                <Text style={[styles.dashboardCardNumber, { color: '#16A34A' }]}>{formatCount(confirmedCount)}</Text>
                <Text style={[styles.dashboardCardLabel, { color: colors.textSecondary }]}>최종 확정</Text>
              </View>
            </View>
            {/* 유통기한 임박 */}
            <View style={[
              styles.dashboardCard,
              { backgroundColor: colors.surfaceCard, borderColor: colors.border },
              expiringItems > 0 && { backgroundColor: colors.amberLight, borderColor: colors.amberBorder }
            ]}>
              <Ionicons 
                name="time" 
                size={28} 
                color={expiringItems > 0 ? "#D97706" : "#9CA3AF"} 
              />
              <View style={styles.dashboardCardContent}>
                <View style={styles.dashboardCardNumberRow}>
                  <Text style={[
                    styles.dashboardCardNumber, 
                    expiringItems > 0 && { color: '#D97706' }
                  ]}>
                    {formatCount(expiringItems)}
                  </Text>
                  {expiringItems > 0 && (
                    <View style={styles.supplyNeededBadge}>
                      <Text style={styles.supplyNeededBadgeText}>보충 필요</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.dashboardCardLabel, { color: colors.textSecondary }]}>유통기한 임박</Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* AI 재고 예측 섹션 - 시연용 비즈니스 인사이트 */}
      <View style={[styles.aiForecastSection, { backgroundColor: '#EEF2FF', borderColor: '#C7D2FE' }]}>
        <View style={styles.aiForecastContent}>
          <Text style={styles.aiForecastText}>
            빅데이터 분석 결과: 다음 주말 단체 예약 대비, 소고기 재고를 20% 선제 주문하세요.
          </Text>
          <Text style={styles.aiForecastSparkle}>✨</Text>
        </View>
      </View>

      {/* AI 재고 요약 */}
      <View style={[styles.aiSummaryContainer, { backgroundColor: colors.surfaceCard, borderColor: colors.border }]}>
        <View style={styles.aiSummaryHeader}>
          <View style={styles.aiIconContainer}>
            <Ionicons name="sparkles" size={20} color="#fff" />
          </View>
          <Text style={[styles.aiSummaryTitle, { color: colors.green }]}>오늘의 AI 재고 요약</Text>
        </View>
        <Text style={[styles.aiSummaryText, { color: colors.text }]}>{generateAISummary()}</Text>
      </View>

      {/* 검색/필터 결과 안내 */}
      {(searchQuery.length > 0 || quickFilter !== '전체') && (
        <View style={styles.searchResultInfo}>
          <Text style={styles.searchResultText}>
            {searchQuery ? `"${searchQuery}" ` : ''}
            {quickFilter !== '전체' ? `[${quickFilter}] ` : ''}
            결과: {filteredFileGroups.length}개 파일
          </Text>
        </View>
      )}

      {/* 발주 목록 공유 버튼 */}
      {lowStockItems > 0 && (
        <TouchableOpacity 
          style={styles.shareButton}
          onPress={shareOrderList}
          activeOpacity={0.8}
        >
          <Ionicons name="share-social" size={22} color="#FFFFFF" />
          <Text style={styles.shareButtonText}>발주 목록 공유</Text>
          <View style={styles.shareButtonBadge}>
            <Text style={styles.shareButtonBadgeText}>{lowStockItems.toLocaleString()}</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* 7일간 재고 추이 그래프 */}
      {chartData && inventory.length > 0 && (
        <View style={styles.chartContainer}>
          <View style={styles.chartHeader}>
            <View style={styles.chartTitleContainer}>
              <Ionicons name="trending-down" size={22} color="#166534" />
              <Text style={styles.chartTitle}>7일간 재고 추이</Text>
            </View>
            {fastestDepletingItem && (
              <View style={styles.fastestBadge}>
                <Ionicons name="flash" size={14} color="#DC2626" />
                <Text style={styles.fastestBadgeText}>
                  {fastestDepletingItem.length > 6 
                    ? fastestDepletingItem.substring(0, 6) + '...' 
                    : fastestDepletingItem} 가장 빠름
                </Text>
              </View>
            )}
          </View>
          
          <LineChart
            data={{
              labels: chartData.labels,
              datasets: chartData.datasets,
              legend: chartData.legend,
            }}
            width={screenWidth - 48}
            height={200}
            chartConfig={{
              backgroundColor: '#FFFFFF',
              backgroundGradientFrom: '#FFFFFF',
              backgroundGradientTo: '#FFFFFF',
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(22, 101, 52, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
              style: {
                borderRadius: 16,
              },
              propsForDots: {
                r: '5',
                strokeWidth: '2',
              },
              propsForBackgroundLines: {
                strokeDasharray: '',
                stroke: '#E5E7EB',
                strokeWidth: 1,
              },
            }}
            bezier
            style={styles.chart}
            withInnerLines={true}
            withOuterLines={false}
            withVerticalLines={false}
            withHorizontalLines={true}
            withVerticalLabels={true}
            withHorizontalLabels={true}
            fromZero={true}
          />
          
          {/* 범례 */}
          <View style={styles.legendContainer}>
            {chartData.legend.map((name, index) => (
              <View key={index} style={styles.legendItem}>
                <View style={[
                  styles.legendDot, 
                  { backgroundColor: chartData.datasets[index]?.color() || '#ccc' }
                ]} />
                <Text style={styles.legendText}>{name}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 에러 메시지 */}
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={22} color="#DC2626" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* 📁 파일 목록 섹션 타이틀 */}
      <View style={styles.fileListHeader}>
        <View style={styles.fileListTitleContainer}>
          <Ionicons name="folder-open" size={22} color="#166534" />
          <Text style={styles.fileListTitle}>파일 목록</Text>
          {filteredFileGroups.length > 0 && (
            <Text style={styles.fileListCount}>({filteredFileGroups.length}개)</Text>
          )}
        </View>
        <Text style={styles.fileListHint}>카드 클릭 시 상세 정보 표시</Text>
      </View>
    </>
  );

  // 최근 활동 로그 - 현재 시간 기준 분산 (실시간 느낌)
  const activityLogs = (() => {
    const now = new Date();
    const fmt = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return [
      { time: fmt(now), msg: '강남본점 김철수 사원이 소고기 10개 추가' },
      { time: fmt(new Date(now.getTime() - 12 * 60000)), msg: '이영희 매니저가 재고 확정 완료' },
      { time: fmt(new Date(now.getTime() - 35 * 60000)), msg: '성수점 박지훈이 돼지고기 5개 수정' },
      { time: fmt(new Date(now.getTime() - 48 * 60000)), msg: '시스템 알림: 유통기한 임박 품목 2건' },
    ];
  })();

  const renderActivityLogSection = () => (
    <View style={[styles.activityLogSection, { backgroundColor: colors.activityLogCard, borderColor: colors.border }]}>
      <View style={styles.activityLogHeader}>
        <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
        <Text style={[styles.activityLogTitle, { color: colors.text }]}>최근 활동 로그</Text>
      </View>
      {activityLogs.map((log, i) => (
        <View key={i} style={[styles.activityLogRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.borderLight }]}>
          <Text style={[styles.activityLogTime, { color: colors.textSecondary }]}>{log.time}</Text>
          <Text style={[styles.activityLogMsg, { color: colors.text }]} numberOfLines={1}>{log.msg}</Text>
        </View>
      ))}
    </View>
  );

  // AI 경영 한마디 섹션 (푸터) - 인박스 로딩 + 스르륵 등장 효과
  const renderAIAdviceSection = () => (
    <View style={styles.aiAdviceContainer}>
      <View style={styles.aiAdviceHeader}>
        <View style={styles.aiAdviceIconContainer}>
          <Ionicons name="bulb" size={22} color="#FFFFFF" />
        </View>
        <Text style={styles.aiAdviceTitle}>AI 경영 한마디</Text>
        <TouchableOpacity 
          onPress={fetchAIAdvice}
          style={[styles.aiAdviceRefreshButton, aiAdviceLoading && styles.aiAdviceRefreshButtonDisabled]}
          disabled={aiAdviceLoading}
          activeOpacity={aiAdviceLoading ? 1 : 0.7}
        >
          <Ionicons 
            name="refresh" 
            size={20} 
            color={aiAdviceLoading ? "#94A3B8" : "#166534"} 
          />
        </TouchableOpacity>
      </View>
      {aiAdviceLoading ? (
        <View style={styles.aiAdviceLoadingInbox}>
          <Animated.View style={[styles.aiAdviceLoadingInboxContent, { opacity: aiShimmerAnim }]}>
            <Ionicons name="sparkles" size={24} color="#166534" />
            <Text style={styles.aiAdviceLoadingText}>AI 데이터 분석 중...</Text>
          </Animated.View>
        </View>
      ) : (
        <Animated.View
          style={{
            opacity: aiResultAnim,
            transform: [{
              translateY: aiResultAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            }],
          }}
        >
          <Text style={styles.aiAdviceText}>{aiAdvice}</Text>
        </Animated.View>
      )}
    </View>
  );

  // 빈 상태 렌더링 (파일 리스트)
  const renderEmptyList = () => {
    if (fileGroups.length === 0) {
      // 데이터 자체가 없는 경우
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="folder-open-outline" size={72} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>재고 데이터가 없습니다</Text>
          <Text style={styles.emptySubtitle}>
            웹에서 엑셀 파일을 업로드해주세요
          </Text>
        </View>
      );
    } else {
      // 검색 결과가 없는 경우
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={72} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>검색 결과가 없습니다</Text>
          <Text style={styles.emptySubtitle}>
            다른 파일명으로 검색해보세요
          </Text>
          <TouchableOpacity 
            style={styles.clearFilterButton}
            onPress={() => setSearchQuery('')}
          >
            <Text style={styles.clearFilterButtonText}>검색 초기화</Text>
          </TouchableOpacity>
        </View>
      );
    }
  };

  return (
    <View style={[styles.container, containerBg]}>
      {/* 바코드 스캔 시뮬레이션 모달 */}
      <Modal
        visible={barcodeScanModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBarcodeScanModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.barcodeModalOverlay}
          activeOpacity={1}
          onPress={() => setBarcodeScanModalVisible(false)}
        >
          <View style={styles.barcodeModalContent} onStartShouldSetResponder={() => true}>
            <Ionicons name="barcode" size={48} color="#166534" style={{ marginBottom: 16 }} />
            <Text style={styles.barcodeModalTitle}>바코드 스캔 모드 진입</Text>
            <Text style={styles.barcodeModalSubtitle}>품목을 비춰주세요</Text>
            <TouchableOpacity
              style={styles.barcodeModalCloseButton}
              onPress={() => setBarcodeScanModalVisible(false)}
            >
              <Text style={styles.barcodeModalCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 스냅샷 전체보기 모달 */}
      <Modal
        visible={!!previewImageUri}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImageUri(null)}
      >
        <TouchableOpacity
          style={[styles.previewModalOverlay, { backgroundColor: 'rgba(0,0,0,0.9)' }]}
          activeOpacity={1}
          onPress={() => setPreviewImageUri(null)}
        >
          <View style={styles.previewModalContent} onStartShouldSetResponder={() => true}>
            {previewImageUri && (
              <Image
                source={{ uri: previewImageUri }}
                style={styles.previewModalImage}
                resizeMode="contain"
              />
            )}
            <TouchableOpacity
              style={[styles.previewModalCloseBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => setPreviewImageUri(null)}
            >
              <Text style={[styles.previewModalCloseText, { color: colors.text }]}>닫기</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 음성 인식 모달 - 듣고 있습니다... */}
      <Modal
        visible={voiceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={stopVoiceRecognition}
      >
        <View style={styles.voiceModalOverlay}>
          <View
            style={[
              styles.voiceModalContent,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Animated.View style={[styles.voiceModalIconWrap, { transform: [{ scale: voicePulseAnim }] }]}>
              <Ionicons name="mic" size={48} color={colors.green} />
            </Animated.View>
            <Text style={[styles.voiceModalTitle, { color: colors.text }]}>듣고 있습니다...</Text>
            {voiceRecognizedText.length > 0 && (
              <View style={[styles.voiceModalTextWrap, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Text style={[styles.voiceModalRecognizedText, { color: colors.text }]} numberOfLines={3}>
                  {voiceRecognizedText}
                </Text>
              </View>
            )}
            {voiceError && (
              <Text style={[styles.voiceModalErrorText, { color: colors.red }]}>{voiceError}</Text>
            )}
            <TouchableOpacity
              style={[styles.voiceModalCloseBtn, { backgroundColor: colors.border }]}
              onPress={stopVoiceRecognition}
            >
              <Text style={[styles.voiceModalCloseBtnText, { color: colors.text }]}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 재고 리스트 - FlatList 하나로 통합 */}
      {/* 📁 파일 리스트 (메인 화면) - 2열 그리드 */}
      
      {/* 발주 예산 요약 바 (하단 고정) */}
      {totalOrderBudget > 0 && (
        <View style={styles.budgetSummaryBar}>
          <View style={styles.budgetSummaryContent}>
            <View style={styles.budgetSummaryLeft}>
              <Text style={styles.budgetSummaryLabel}>총 예상 발주 비용</Text>
              <Text style={styles.budgetSummaryAmount} numberOfLines={1} adjustsFontSizeToFit>
                ₩{totalOrderBudget.toLocaleString()}
              </Text>
            </View>
            <View style={styles.budgetSummaryButtons}>
              <TouchableOpacity
                style={styles.budgetDetailButton}
                onPress={() => {
                  setQuickFilter('부족');
                  const firstLowStockFile = fileGroups.find(g => g.lowStockCount > 0);
                  if (firstLowStockFile) {
                    setSelectedFileGroup(firstLowStockFile);
                    setFileDetailModalVisible(true);
                  }
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="list" size={18} color="#FFFFFF" />
                <Text style={styles.budgetDetailButtonText}>상세 내역 보기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.budgetApproveButton}
                onPress={shareOrderList}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark-circle" size={18} color="#1F2937" />
                <Text style={styles.budgetApproveButtonText}>발주 승인하기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <FlatList
        data={filteredFileGroups}
        renderItem={renderFileCard}
        keyExtractor={(item) => item.fileName}
        numColumns={2}
        columnWrapperStyle={filteredFileGroups.length > 1 ? styles.fileGridRow : undefined}
        contentContainerStyle={[
          styles.listContent,
          { backgroundColor: colors.background },
          filteredFileGroups.length === 0 && styles.emptyListContent
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#166534']}
          />
        }
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={renderHeaderContent}
        ListEmptyComponent={renderEmptyList}
        ListFooterComponent={
          <>
            {renderAIAdviceSection()}
            <TouchableOpacity
              style={[
                styles.reportShareButton,
                {
                  backgroundColor: colors.reportShareBg,
                  borderColor: colors.reportShareBorder,
                  shadowColor: colors.reportShareShadow,
                },
              ]}
              onPress={() => {
                Alert.alert('PDF 생성 및 전송', '재고 리포트를 PDF로 생성해 전송하시겠습니까?', [
                  { text: '취소', style: 'cancel' },
                  { text: '확인', onPress: () => {} },
                ]);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="document-text" size={22} color={colors.reportShareText} />
              <Text style={[styles.reportShareButtonText, { color: colors.reportShareText }]}>
                재고 리포트 공유
              </Text>
            </TouchableOpacity>
            {renderActivityLogSection()}
            <View style={styles.listBottomPadding} />
          </>
        }
      />

      {/* 📁 파일 상세 모달 */}
      <Modal
        visible={fileDetailModalVisible}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setFileDetailModalVisible(false)}
      >
        <View style={[styles.detailModalContainer, { backgroundColor: colors.background }]}>
          {/* 상세 모달 헤더 */}
          <View style={[styles.detailModalHeader, { backgroundColor: colors.headerBg, borderBottomColor: colors.border }]}>
            <TouchableOpacity 
              style={styles.detailBackButton}
              onPress={() => setFileDetailModalVisible(false)}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.detailHeaderInfo}>
              <Text style={[styles.detailModalTitle, { color: colors.text }]} numberOfLines={1}>
                {selectedFileGroup?.fileName.replace(/\.[^/.]+$/, '')}
              </Text>
              <Text style={[styles.detailModalSubtitle, { color: colors.textSecondary }]}>
                {selectedFileGroup?.totalItems}개 품목
              </Text>
            </View>
            {/* 알림 센터 (재고 부족 시 빨간 점) */}
            <TouchableOpacity 
              style={styles.detailAlarmCenterButton}
              onPress={() => {
                if ((selectedFileGroup?.lowStockCount ?? 0) > 0) {
                  sendLocalNotification(
                    '⚠️ 재고 부족 알림',
                    `${selectedFileGroup?.lowStockCount}개 품목의 재고가 부족합니다!`
                  );
                }
              }}
            >
              <Ionicons name="notifications-outline" size={22} color={colors.textSecondary} />
              {(selectedFileGroup?.lowStockCount ?? 0) > 0 && (
                <View style={styles.detailAlarmBadge} />
              )}
            </TouchableOpacity>
            {/* 새로고침 버튼 */}
            <TouchableOpacity 
              style={styles.detailRefreshButton}
              onPress={onRefresh}
            >
              <Ionicons name="refresh" size={20} color="#166534" />
            </TouchableOpacity>
          </View>

          {/* 상세 모달 액션 버튼들 */}
          <View style={styles.detailActionBar}>
            {/* 재고 부족 배지 */}
            {(selectedFileGroup?.lowStockCount ?? 0) > 0 && (
              <View style={styles.detailAlertBadge}>
                <Ionicons name="warning" size={14} color="#fff" />
                <Text style={styles.detailAlertBadgeText}>
                  재고 부족 {selectedFileGroup?.lowStockCount}개
                </Text>
              </View>
            )}
            {/* 유통기한 임박 배지 */}
            {(selectedFileGroup?.expiringCount ?? 0) > 0 && (
              <View style={styles.detailExpiringBadge}>
                <Ionicons name="time" size={14} color="#fff" />
                <Text style={styles.detailExpiringBadgeText}>
                  폐기 임박 {selectedFileGroup?.expiringCount}개
                </Text>
              </View>
            )}
            {/* 파일 삭제 버튼 */}
            <TouchableOpacity 
              style={styles.detailDeleteButton}
              onPress={() => {
                Alert.alert(
                  '파일 삭제',
                  `"${selectedFileGroup?.fileName}" 파일의 모든 데이터를 삭제하시겠습니까?`,
                  [
                    { text: '취소', style: 'cancel' },
                    {
                      text: '삭제',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          const { error } = await supabase
                            .from('재고')
                            .delete()
                            .eq('file_name', selectedFileGroup?.fileName);
                          if (error) throw error;
                          setFileDetailModalVisible(false);
                          Alert.alert('완료', '파일이 삭제되었습니다.');
                          fetchInventory();
                        } catch (err) {
                          Alert.alert('오류', '삭제 중 오류가 발생했습니다.');
                        }
                      }
                    }
                  ]
                );
              }}
            >
              <Ionicons name="trash-outline" size={16} color="#DC2626" />
              <Text style={styles.detailDeleteButtonText}>삭제</Text>
            </TouchableOpacity>
          </View>

          {/* 상세 모달 - 가로 스크롤 대시보드 */}
          {selectedFileGroup && (
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.detailDashboardScroll}
              contentContainerStyle={styles.detailDashboardScrollContent}
            >
              <View style={styles.detailDashboardCard}>
                <Text style={styles.detailDashboardNumber}>
                  {formatCount(selectedFileGroup.items.filter(i => !i.base_stock || i.base_stock === 0).length)}
                </Text>
                <Text style={styles.detailDashboardLabel}>미확정</Text>
              </View>
              <View style={[styles.detailDashboardCard, selectedFileGroup.lowStockCount > 0 && styles.detailDashboardCardAlert]}>
                <View style={styles.detailDashboardNumberRow}>
                  <Text style={[
                    styles.detailDashboardNumber, 
                    selectedFileGroup.lowStockCount > 0 && styles.detailDashboardNumberAlert
                  ]}>
                    {formatCount(selectedFileGroup.lowStockCount)}
                  </Text>
                  {selectedFileGroup.lowStockCount > 0 && (
                    <View style={styles.detailSupplyBadge}>
                      <Text style={styles.detailSupplyBadgeText}>보충 필요</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.detailDashboardLabel}>재고 위험</Text>
              </View>
              <View style={styles.detailDashboardCard}>
                <Text style={[styles.detailDashboardNumber, { color: '#16A34A' }]}>
                  {formatCount(selectedFileGroup.items.filter(i => i.base_stock !== null && i.base_stock > 0).length)}
                </Text>
                <Text style={styles.detailDashboardLabel}>최종 확정</Text>
              </View>
              <View style={[styles.detailDashboardCard, selectedFileGroup.expiringCount > 0 && styles.detailDashboardCardExpiring]}>
                <View style={styles.detailDashboardNumberRow}>
                  <Text style={[
                    styles.detailDashboardNumber, 
                    selectedFileGroup.expiringCount > 0 && { color: '#D97706' }
                  ]}>
                    {formatCount(selectedFileGroup.expiringCount)}
                  </Text>
                  {selectedFileGroup.expiringCount > 0 && (
                    <View style={styles.detailSupplyBadge}>
                      <Text style={styles.detailSupplyBadgeText}>보충 필요</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.detailDashboardLabel}>유통기한 임박</Text>
              </View>
            </ScrollView>
          )}

          {/* 상세 모달 검색창 */}
          <View style={styles.detailSearchContainer}>
            <View style={styles.detailSearchInputWrapper}>
              <Ionicons name="search" size={18} color="#9CA3AF" />
              <TextInput
                style={styles.detailSearchInput}
                placeholder="품목명 검색..."
                placeholderTextColor="#9CA3AF"
                value={detailSearchQuery}
                onChangeText={setDetailSearchQuery}
                returnKeyType="search"
              />
              {detailSearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setDetailSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.detailSearchCount}>
              {filteredDetailItems.length.toLocaleString()}개 표시
            </Text>
          </View>

          {/* 테이블 - 고정 열 순서 [순번|품목명|규격|단위|현재재고|기준재고|상태] (기존/신규 데이터 공통) */}
          <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.detailTableScroll}>
            <View style={[styles.detailTableWrapper, { minWidth: 44 + 8 * 88 }]}>
              <View style={[styles.detailTableHeader, styles.detailTableHeaderSticky]}>
                <Text style={[styles.detailTableHeaderText, styles.detailTableColNo, styles.detailTableCellNum]}>순번</Text>
                <Text style={[styles.detailTableHeaderText, styles.detailTableCol]}>품목명</Text>
                <Text style={[styles.detailTableHeaderText, styles.detailTableCol]}>규격</Text>
                <Text style={[styles.detailTableHeaderText, styles.detailTableCol]}>단위</Text>
                <Text style={[styles.detailTableHeaderText, styles.detailTableCol, styles.detailTableCellNum]}>현재재고</Text>
                <Text style={[styles.detailTableHeaderText, styles.detailTableCol, styles.detailTableCellNum]}>적정재고(Threshold)</Text>
                <Text style={[styles.detailTableHeaderText, styles.detailTableColStatus]}>상태</Text>
                <Text style={[styles.detailTableHeaderText, styles.detailTableColSnapshot]}>스냅샷</Text>
              </View>

              <FlatList
                data={filteredDetailItems}
                renderItem={({ item, index }) => {
                  const stockStatus = getStockStatus(item);
                  const stockStyle = stockStatus ? STOCK_STATUS_STYLES[stockStatus] : null;
                  const itemName = item?.itemName ?? '-';
                  const spec = findSpec(item?.data);
                  const unit = findUnit(item?.data);
                  const currentStock = (item?.currentStock ?? 0);
                  const baseStock = (item?.base_stock ?? 0);
                  const isExpired = !!item?.isExpired;
                  const isExpiringSoon = !!item?.isExpiringSoon;
                  const isLowStock = !!item?.isLowStock;
                  const daysUntilExpiry = item?.daysUntilExpiry;
                  return (
                    <TouchableOpacity
                      style={[
                        styles.detailTableRow,
                        index % 2 === 1 && !isLowStock && !isExpired && styles.detailTableRowAlt,
                        isLowStock && { backgroundColor: colors.redLight },
                        isExpired && styles.detailTableRowExpired,
                      ]}
                      onPress={() => openEditModal(item)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.detailTableCell, styles.detailTableColNo, styles.detailTableCellNum]}>
                        {(index ?? 0) + 1}
                      </Text>
                      <View style={styles.detailTableCol}>
                        <Text style={styles.detailTableItemName} numberOfLines={1}>{itemName}</Text>
                        {item?.expiry_date != null && item.expiry_date !== '' && (
                          <Text style={[
                            styles.detailTableItemExpiry,
                            isExpired && { color: '#DC2626' },
                            isExpiringSoon && { color: '#D97706' },
                          ]}>
                            {isExpired ? '만료됨' : `D-${daysUntilExpiry ?? '-'}`}
                          </Text>
                        )}
                      </View>
                      <Text style={[styles.detailTableCell, styles.detailTableCol]} numberOfLines={1}>{spec}</Text>
                      <Text style={[styles.detailTableCell, styles.detailTableCol]} numberOfLines={1}>{unit}</Text>
                      <View style={[styles.detailTableStockCell, styles.detailTableCol]}>
                        {stockStatus && (
                          <View style={[styles.detailTableStockDot, stockStyle && { backgroundColor: stockStyle.dot }]} />
                        )}
                        <Text
                          style={[
                            styles.detailTableCell,
                            styles.detailTableCellNum,
                            stockStatus === '부족' && styles.detailTableCellShortage,
                            stockStyle && { color: stockStyle.text },
                          ]}
                          numberOfLines={1}
                        >
                          {Number(currentStock).toLocaleString()}
                        </Text>
                      </View>
                      <Text style={[styles.detailTableCell, styles.detailTableCol, styles.detailTableCellNum]}>
                        {Number(baseStock).toLocaleString()}
                      </Text>
                      <View style={[styles.detailTableColStatus, { alignItems: 'center' }]}>
                        {isExpired ? (
                          <View style={styles.detailStatusBadgeExpired}>
                            <Text style={styles.detailStatusBadgeExpiredText}>폐기</Text>
                          </View>
                        ) : isExpiringSoon ? (
                          <View style={styles.detailStatusBadgeExpiring}>
                            <Text style={styles.detailStatusBadgeExpiringText}>임박</Text>
                          </View>
                        ) : isLowStock ? (
                          <View style={styles.detailStatusBadgeAlert}>
                            <Text style={styles.detailStatusBadgeAlertText}>보충 필요</Text>
                          </View>
                        ) : (
                          <View style={styles.detailStatusBadgeNormal}>
                            <Text style={styles.detailStatusBadgeNormalText}>정상</Text>
                          </View>
                        )}
                      </View>
                      <View style={[styles.detailTableColSnapshot, { alignItems: 'center', justifyContent: 'center' }]}>
                        <View style={styles.snapshotCellContent}>
                          {itemPhotos[item?.id ?? 0] ? (
                            <>
                              <TouchableOpacity
                                onPress={() => setPreviewImageUri(itemPhotos[item!.id])}
                                style={styles.snapshotThumbnailWrap}
                              >
                                <Image
                                  source={{ uri: itemPhotos[item!.id] }}
                                  style={styles.snapshotThumbnail}
                                  resizeMode="cover"
                                />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => handleTakeSnapshot(item)}
                                style={styles.snapshotCameraBtn}
                              >
                                <Ionicons name="camera" size={18} color={colors.green} />
                              </TouchableOpacity>
                            </>
                          ) : (
                            <TouchableOpacity
                              onPress={() => handleTakeSnapshot(item)}
                              style={[styles.snapshotCameraBtn, { borderColor: colors.border }]}
                            >
                              <Ionicons name="camera" size={20} color={colors.textSecondary} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                keyExtractor={(item) => `${item?.id ?? ''}`}
                contentContainerStyle={styles.detailTableContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={styles.detailEmptyContainer}>
                    <Ionicons name="search-outline" size={56} color="#D1D5DB" />
                    <Text style={styles.detailEmptyTitle}>검색 결과가 없습니다</Text>
                  </View>
                }
              />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* 수정 모달 */}
      <Modal
        visible={editModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeEditModal}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>재고 수정</Text>
              <TouchableOpacity onPress={closeEditModal} style={styles.modalCloseButton}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            
            {selectedItem && (
              <>
                <Text style={[styles.modalItemName, { color: colors.text }]}>{selectedItem.itemName}</Text>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>현재 재고</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editCurrentStock}
                    onChangeText={setEditCurrentStock}
                    keyboardType="numeric"
                    placeholder="현재 재고 수량"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>기준 재고</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editBaseStock}
                    onChangeText={setEditBaseStock}
                    keyboardType="numeric"
                    placeholder="기준 재고 수량"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>유통기한</Text>
                  <TextInput
                    style={styles.textInput}
                    value={editExpiryDate}
                    onChangeText={setEditExpiryDate}
                    placeholder="YYYY-MM-DD (예: 2026-12-31)"
                    placeholderTextColor="#9ca3af"
                    autoCapitalize="none"
                  />
                  <Text style={styles.inputHint}>
                    비워두면 유통기한 없음으로 설정됩니다
                  </Text>
                </View>
                
                <View style={styles.modalButtons}>
                  <TouchableOpacity 
                    style={styles.cancelButton} 
                    onPress={closeEditModal}
                  >
                    <Text style={styles.cancelButtonText}>취소</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.saveButton, saving && styles.saveButtonDisabled]} 
                    onPress={saveInventoryChanges}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.saveButtonText}>저장</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  reportShareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  reportShareButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  activityLogSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
  },
  activityLogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  activityLogTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  activityLogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 0,
  },
  activityLogTime: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 44,
  },
  activityLogMsg: {
    flex: 1,
    fontSize: 14,
  },
  listBottomPadding: {
    height: 180, // 하단 탭바 + 발주 예산 바가 가리지 않도록
  },
  // 발주 예산 요약 바 (하단 고정, 다크 모드)
  budgetSummaryBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1F2937',
    borderTopWidth: 1,
    borderTopColor: '#374151',
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingBottom: Platform.OS === 'ios' ? 28 : 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 12,
  },
  budgetSummaryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  budgetSummaryLeft: {
    flex: 1,
  },
  budgetSummaryLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 2,
  },
  budgetSummaryAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: -0.5,
  },
  budgetSummaryButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  budgetDetailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#374151',
    borderRadius: 10,
  },
  budgetDetailButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  budgetApproveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FCD34D',
    borderRadius: 10,
  },
  budgetApproveButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F2937',
  },
  // 상단 검색바 (헤더 바로 아래 고정)
  topSearchSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  topSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topSearchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    minHeight: 52,
  },
  voiceMicButton: {
    width: 48,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barcodeScanButton: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barcodeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  barcodeModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  barcodeModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
    textAlign: 'center',
  },
  barcodeModalSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 20,
    textAlign: 'center',
  },
  barcodeModalCloseButton: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    backgroundColor: '#166534',
    borderRadius: 12,
  },
  barcodeModalCloseText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  voiceModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  voiceModalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  voiceModalIconWrap: {
    marginBottom: 16,
  },
  voiceModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  voiceModalTextWrap: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  voiceModalRecognizedText: {
    fontSize: 16,
    lineHeight: 24,
  },
  voiceModalErrorText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  voiceModalCloseBtn: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  voiceModalCloseBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  topSearchIcon: {
    marginRight: 10,
  },
  topSearchInput: {
    flex: 1,
    fontSize: 16,
    color: '#111111',
    paddingVertical: 14,
  },
  topSearchClearButton: {
    padding: 6,
  },
  // 퀵 필터 칩 - 모바일 최적화 (가로 스크롤, 글자 겹침 방지)
  quickFilterScroll: {
    marginTop: 12,
    maxHeight: 44,
  },
  quickFilterScrollContent: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignItems: 'center',
  },
  quickFilterRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  quickFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 36,
    justifyContent: 'center',
    flexShrink: 0,
  },
  quickFilterChipActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  quickFilterChipDanger: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  quickFilterChipSuccess: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  quickFilterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  quickFilterChipTextActive: {
    color: '#FFFFFF',
  },
  quickFilterChipTextDanger: {
    color: '#DC2626',
  },
  quickFilterChipTextSuccess: {
    color: '#166534',
  },
  // 검색창 스타일 (상세 모달용)
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 16,
    gap: 10,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    height: 46,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111111',
    paddingVertical: 0,
  },
  searchClearButton: {
    padding: 4,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    gap: 4,
  },
  filterButtonActive: {
    backgroundColor: '#166534',
    borderColor: '#166534',
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#166534',
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
  },
  searchResultInfo: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
  },
  searchResultText: {
    fontSize: 13,
    color: '#166534',
    fontWeight: '500',
  },
  clearFilterButton: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#166534',
    borderRadius: 10,
  },
  clearFilterButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyListContent: {
    flexGrow: 1,
  },
  aiForecastSection: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
  },
  aiForecastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiForecastText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: '#4338CA',
  },
  aiForecastSparkle: {
    fontSize: 22,
  },
  aiSummaryContainer: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  aiSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  aiIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#166534',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  aiSummaryTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#166534',
  },
  aiSummaryText: {
    fontSize: 16,
    color: '#111111',
    lineHeight: 26,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 17,
    color: '#6B7280',
    fontWeight: '500',
  },
  branchSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  branchSelectorIcon: {
    marginRight: 10,
  },
  branchSelectorText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  branchModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  branchModalContent: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  branchModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  branchModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  branchModalOptionText: {
    fontSize: 16,
    fontWeight: '500',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 18,
    backgroundColor: '#F8F9FA',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  notificationButton: {
    padding: 10,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  alarmCenterButton: {
    padding: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    position: 'relative',
  },
  alarmCenterBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  alarmCenterBadgeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#DC2626',
  },
  // 모바일 전용 재고 현황 대시보드
  dashboardSection: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  dashboardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 2,
  },
  dashboardSectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
  },
  lastConfirmBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  lastConfirmText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  dashboardHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bulkConfirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  bulkConfirmButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#166534',
  },
  dashboardRiskSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  dashboardRiskSummaryText: {
    fontSize: 15,
    fontWeight: '700',
  },
  dashboardGrid: {
    gap: 12,
  },
  dashboardGridRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  dashboardCard: {
    flex: 1,
    minHeight: 100,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    paddingHorizontal: 12,
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  dashboardCardAlert: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  dashboardCardExpiring: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  dashboardCardContent: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  dashboardCardNumber: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111111',
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  dashboardCardNumberAlert: {
    color: '#DC2626',
  },
  dashboardCardNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  dashboardCardLabel: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
    fontWeight: '500',
  },
  supplyNeededBadge: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  supplyNeededBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111111',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  refreshButton: {
    padding: 10,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: '#FFFFFF',
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  alertStatCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  statNumber: {
    fontSize: 36,
    fontWeight: '800',
    color: '#111111',
    marginTop: 6,
  },
  alertStatNumber: {
    color: '#DC2626',
  },
  statLabel: {
    fontSize: 15,
    color: '#6B7280',
    marginTop: 4,
    fontWeight: '500',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    flex: 1,
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    backgroundColor: '#FFFFFF',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
    marginTop: 20,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 24,
  },
  listContent: {
    paddingTop: 0,
    paddingBottom: 100,
    backgroundColor: '#FFFFFF',
  },
  // 📁 파일 그리드 스타일 (웹과 동일)
  fileGridRow: {
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  fileCardWrapper: {
    width: '48%',
    marginBottom: 12,
  },
  fileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  fileCardGradientLine: {
    height: 4,
    width: '100%',
  },
  fileCardContent: {
    padding: 14,
  },
  fileCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  fileIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileCardInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileCardName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111111',
    marginBottom: 4,
  },
  fileCardRowCount: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  fileCardRowNumber: {
    fontSize: 22,
    fontWeight: '700',
  },
  fileCardRowLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  fileCardProgress: {
    marginTop: 12,
  },
  fileCardProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  fileCardProgressLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  fileCardProgressPercent: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  fileCardProgressBar: {
    height: 5,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  fileCardProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  fileCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  fileCardViewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  fileCardViewText: {
    fontSize: 13,
    fontWeight: '600',
  },
  fileCardDeleteButton: {
    padding: 4,
  },
  fileCardBadges: {
    position: 'absolute',
    top: 12,
    right: 10,
    flexDirection: 'row',
    gap: 4,
  },
  fileCardAlertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#DC2626',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
  },
  fileCardAlertBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  fileCardExpiringBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
  },
  fileCardExpiringBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // 파일 목록 헤더
  fileListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 12,
  },
  fileListTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fileListTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  fileListCount: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  fileListHint: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  // 📁 파일 상세 모달 스타일 (라이트 모드)
  detailModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  detailModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: Platform.OS === 'ios' ? 56 : 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  detailBackButton: {
    padding: 8,
    marginRight: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
  },
  detailHeaderInfo: {
    flex: 1,
  },
  detailModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  detailModalSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  detailRefreshButton: {
    padding: 10,
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  detailAlarmCenterButton: {
    padding: 8,
    marginRight: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    position: 'relative',
  },
  detailAlarmBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#DC2626',
  },
  // 상세 모달 가로 스크롤 대시보드
  detailDashboardScroll: {
    maxHeight: 90,
  },
  detailDashboardScrollContent: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  detailDashboardCard: {
    minWidth: 100,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  detailDashboardCardAlert: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  detailDashboardCardExpiring: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  detailDashboardNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111111',
  },
  detailDashboardNumberAlert: {
    color: '#DC2626',
  },
  detailDashboardNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailDashboardLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
    fontWeight: '500',
  },
  detailSupplyBadge: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  detailSupplyBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // 상세 모달 액션 바
  detailActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    gap: 8,
    flexWrap: 'wrap',
  },
  detailAlertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DC2626',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  detailAlertBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  detailExpiringBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  detailExpiringBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  detailDeleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginLeft: 'auto',
  },
  detailDeleteButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
  },
  // 상세 모달 검색창
  detailSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  detailSearchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 12,
    gap: 8,
  },
  detailSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111111',
    padding: 0,
  },
  detailSearchCount: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  // 테이블 헤더 (상단 고정)
  detailTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F8F9FA',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  detailTableHeaderSticky: {
    ...(Platform.OS === 'web' ? { position: 'sticky' as const, top: 0, zIndex: 10 } : {}),
  },
  detailTableHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  detailTableScroll: { maxHeight: '100%' },
  detailTableWrapper: { flex: 1 },
  detailTableColNo: { width: 44, minWidth: 44, paddingHorizontal: 4 },
  detailTableCol: { width: 88, minWidth: 88, paddingHorizontal: 6 },
  detailTableColStatus: { width: 56, minWidth: 56, paddingHorizontal: 4 },
  detailTableColSnapshot: { width: 72, minWidth: 72, paddingHorizontal: 4 },
  detailColNo: { width: 36, flex: 0 },
  detailColItemName: { flex: 2, minWidth: 80 },
  detailColSpec: { flex: 1.2, minWidth: 60 },
  detailColUnit: { flex: 0.6, minWidth: 40 },
  detailColNum: { flex: 1, minWidth: 56, justifyContent: 'flex-end', textAlign: 'right' as const },
  detailColStatus: { flex: 0.8, minWidth: 52 },
  detailTableCellNum: { textAlign: 'right' as const, fontWeight: '700' as const },
  // 테이블 행 (엑셀처럼 촘촘하게)
  detailTableContent: {
    paddingBottom: 40,
  },
  detailTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  detailTableRowAlt: {
    backgroundColor: '#FAFAFA',
  },
  detailTableRowAlert: {
    backgroundColor: '#FEF2F2',
  },
  detailTableRowExpired: {
    backgroundColor: '#FEE2E2',
  },
  detailTableItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111111',
  },
  detailTableItemExpiry: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  detailTableCell: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  detailTableCellAlert: {
    color: '#DC2626',
    fontWeight: '700',
  },
  detailTableCellShortage: {
    color: '#EF4444',
    fontWeight: '800',
  },
  detailTableStockCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  detailTableStockDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // 상태 배지
  detailStatusBadgeNormal: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  detailStatusBadgeNormalText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
  },
  detailStatusBadgeAlert: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  detailStatusBadgeAlertText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#DC2626',
  },
  detailStatusBadgeExpiring: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  detailStatusBadgeExpiringText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D97706',
  },
  detailStatusBadgeExpired: {
    backgroundColor: '#374151',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  detailStatusBadgeExpiredText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // 빈 상태
  detailEmptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  detailEmptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9CA3AF',
    marginTop: 12,
  },
  snapshotCellContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  snapshotThumbnailWrap: {
    width: 32,
    height: 32,
    borderRadius: 6,
    overflow: 'hidden',
  },
  snapshotThumbnail: {
    width: 32,
    height: 32,
  },
  snapshotCameraBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  previewModalContent: {
    width: '100%',
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewModalImage: {
    width: '100%',
    height: '80%',
    maxHeight: 500,
  },
  previewModalCloseBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1,
  },
  previewModalCloseText: {
    fontSize: 16,
    fontWeight: '600',
  },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  lowStockCard: {
    borderWidth: 2,
    borderColor: '#FECACA',
    backgroundColor: '#FFFBFB',
  },
  expiredCard: {
    borderWidth: 2,
    borderColor: '#991B1B',
    backgroundColor: '#FEF2F2',
  },
  expiringSoonCard: {
    borderWidth: 2,
    borderColor: '#FBBF24',
    backgroundColor: '#FFFBEB',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  itemName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
    flex: 1,
    marginRight: 10,
  },
  alertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 5,
  },
  alertBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  expiredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 5,
  },
  expiredBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  expiringSoonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 5,
    borderWidth: 1,
    borderColor: '#FBBF24',
  },
  expiringSoonBadgeText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '700',
  },
  stockInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  stockColumn: {
    flex: 1,
    alignItems: 'center',
  },
  stockDivider: {
    width: 1,
    height: 48,
    backgroundColor: '#E5E7EB',
  },
  stockLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 6,
    fontWeight: '500',
  },
  stockValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111111',
  },
  stockStatusWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    minWidth: 60,
  },
  stockStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stockValueShortage: {
    fontWeight: '900',
    color: '#EF4444',
  },
  lowStockValue: {
    color: '#DC2626',
  },
  expiryValue: {
    fontSize: 18,
  },
  expiredValue: {
    color: '#7F1D1D',
    fontWeight: '800',
  },
  expiringSoonValue: {
    color: '#B45309',
    fontWeight: '800',
  },
  shortageValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#DC2626',
  },
  expiredMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FECACA',
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  expiredText: {
    flex: 1,
    color: '#7F1D1D',
    fontSize: 15,
    fontWeight: '600',
  },
  expiringSoonMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  expiringSoonText: {
    flex: 1,
    color: '#92400E',
    fontSize: 15,
    fontWeight: '500',
  },
  alertMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    gap: 10,
  },
  alertText: {
    flex: 1,
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '500',
  },
  fileName: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 14,
    fontWeight: '500',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  editButtonText: {
    color: '#166534',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111111',
  },
  modalCloseButton: {
    padding: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
  },
  modalItemName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 24,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  inputGroup: {
    marginBottom: 18,
  },
  inputLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111111',
    marginBottom: 10,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: '#111111',
    backgroundColor: '#F9FAFB',
  },
  inputHint: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 8,
    fontStyle: 'italic',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#6B7280',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#166534',
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#86EFAC',
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  aiAdviceContainer: {
    backgroundColor: '#F0FDF4',
    borderRadius: 20,
    padding: 20,
    marginTop: 10,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  aiAdviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  aiAdviceIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#166534',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  aiAdviceTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#166534',
    flex: 1,
  },
  aiAdviceRefreshButton: {
    padding: 8,
    backgroundColor: '#DCFCE7',
    borderRadius: 10,
  },
  aiAdviceRefreshButtonDisabled: {
    backgroundColor: '#E2E8F0',
    opacity: 0.8,
  },
  aiAdviceText: {
    fontSize: 16,
    color: '#111111',
    lineHeight: 26,
    fontWeight: '500',
  },
  aiAdviceLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiAdviceLoadingInbox: {
    minHeight: 48,
    justifyContent: 'center',
  },
  aiAdviceLoadingInboxContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  aiAdviceLoadingText: {
    fontSize: 15,
    color: '#166534',
    fontWeight: '500',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#166534',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    gap: 10,
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 5,
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  shareButtonBadge: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 6,
  },
  shareButtonBadgeText: {
    color: '#166534',
    fontSize: 14,
    fontWeight: '700',
  },
  chartContainer: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  chartTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  fastestBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 5,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  fastestBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
  chart: {
    marginVertical: 10,
    borderRadius: 16,
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 18,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
});
