import { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { AppColors } from '@/constants/theme-colors';
import { supabase } from '@/lib/supabase';

const RESET_PASSWORD = '1234';

export default function SettingsScreen() {
  const { isDark } = useAppTheme();
  const colors = AppColors[isDark ? 'dark' : 'light'];

  const [modalVisible, setModalVisible] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [resetting, setResetting] = useState(false);

  const openModal = () => {
    setModalVisible(true);
    setPasswordInput('');
    setErrorMessage('');
    setSuccessMessage('');
  };

  const closeModal = () => {
    setModalVisible(false);
    setPasswordInput('');
    setErrorMessage('');
    setSuccessMessage('');
  };

  const handleReset = async () => {
    setErrorMessage('');
    setSuccessMessage('');

    if (passwordInput !== RESET_PASSWORD) {
      setErrorMessage('비밀번호가 일치하지 않습니다.');
      return;
    }

    setResetting(true);
    try {
      const { error } = await supabase.from('재고').delete().neq('id', -1);

      if (error) {
        setErrorMessage(error.message || '초기화에 실패했습니다.');
        return;
      }

      setSuccessMessage('데모 데이터가 성공적으로 초기화되었습니다.');
      setTimeout(() => {
        closeModal();
      }, 1500);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '초기화 중 오류가 발생했습니다.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.headerBg, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>설정</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.section, { backgroundColor: colors.surfaceCard, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>데이터 관리</Text>
          <TouchableOpacity
            style={[
              styles.resetButton,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
            onPress={openModal}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={22} color={colors.red} />
            <Text style={[styles.resetButtonText, { color: colors.text }]}>데모 데이터 초기화</Text>
          </TouchableOpacity>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            비밀번호 확인 후 재고 테이블 데이터가 삭제됩니다.
          </Text>
        </View>
      </ScrollView>

      {/* 비밀번호 확인 모달 */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeModal}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKeyboardView}
          >
            <View
              style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onStartShouldSetResponder={() => true}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>비밀번호 확인</Text>
              <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                데모 데이터 초기화를 위해 비밀번호를 입력해주세요.
              </Text>

              <TextInput
                style={[
                  styles.passwordInput,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder="비밀번호"
                placeholderTextColor={colors.textMuted}
                value={passwordInput}
                onChangeText={(t) => {
                  setPasswordInput(t);
                  setErrorMessage('');
                }}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />

              {errorMessage.length > 0 && (
                <View style={[styles.messageBox, { backgroundColor: colors.errorMsgBg }]}>
                  <Ionicons name="alert-circle" size={18} color={colors.errorMsgText} />
                  <Text style={[styles.messageText, { color: colors.errorMsgText }]}>
                    {errorMessage}
                  </Text>
                </View>
              )}

              {successMessage.length > 0 && (
                <View style={[styles.messageBox, { backgroundColor: colors.successMsgBg }]}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.successMsgText} />
                  <Text style={[styles.messageText, { color: colors.successMsgText }]}>
                    {successMessage}
                  </Text>
                </View>
              )}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton, { borderColor: colors.border }]}
                  onPress={closeModal}
                  disabled={resetting}
                >
                  <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.confirmButton, { backgroundColor: colors.red }]}
                  onPress={handleReset}
                  disabled={resetting}
                >
                  {resetting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.confirmButtonText}>확인</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 18,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  section: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    fontSize: 13,
    marginTop: 12,
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalKeyboardView: {
    width: '100%',
    maxWidth: 360,
  },
  modalContent: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 22,
  },
  passwordInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  messageBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  messageText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  modalButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {},
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
