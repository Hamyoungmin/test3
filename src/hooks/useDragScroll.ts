'use client';

import { useRef, useEffect, useCallback, useState } from 'react';

interface DragScrollOptions {
  sensitivity?: number; // 드래그 감도 (기본: 1)
  smoothness?: number;  // 부드러움 정도 (기본: 0.92, 높을수록 오래 미끄러짐)
}

export function useDragScroll(options: DragScrollOptions = {}) {
  const { sensitivity = 1, smoothness = 0.92 } = options;
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // 드래그 상태 추적
  const dragState = useRef({
    isDown: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    velocityX: 0,
    velocityY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    animationId: 0,
  });

  // 관성 스크롤 애니메이션
  const animateScroll = useCallback(() => {
    const container = containerRef.current;
    const state = dragState.current;
    
    if (!container || (Math.abs(state.velocityX) < 0.5 && Math.abs(state.velocityY) < 0.5)) {
      state.animationId = 0;
      return;
    }

    container.scrollLeft += state.velocityX;
    container.scrollTop += state.velocityY;
    
    state.velocityX *= smoothness;
    state.velocityY *= smoothness;
    
    state.animationId = requestAnimationFrame(animateScroll);
  }, [smoothness]);

  // 마우스 다운
  const handleMouseDown = useCallback((e: MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    
    // 입력 필드나 버튼 클릭 시 드래그 방지
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('[contenteditable]')
    ) {
      return;
    }
    
    // 기존 애니메이션 중지
    if (dragState.current.animationId) {
      cancelAnimationFrame(dragState.current.animationId);
    }

    dragState.current = {
      ...dragState.current,
      isDown: true,
      startX: e.pageX - container.offsetLeft,
      startY: e.pageY - container.offsetTop,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      velocityX: 0,
      velocityY: 0,
      lastX: e.pageX,
      lastY: e.pageY,
      lastTime: Date.now(),
    };
    
    setIsDragging(true);
    container.style.cursor = 'grabbing';
    container.style.userSelect = 'none';
  }, []);

  // 마우스 업
  const handleMouseUp = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    
    if (dragState.current.isDown) {
      dragState.current.isDown = false;
      setIsDragging(false);
      container.style.cursor = 'grab';
      container.style.userSelect = '';
      
      // 관성 스크롤 시작
      if (Math.abs(dragState.current.velocityX) > 1 || Math.abs(dragState.current.velocityY) > 1) {
        animateScroll();
      }
    }
  }, [animateScroll]);

  // 마우스 이동
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const container = containerRef.current;
    const state = dragState.current;
    
    if (!container || !state.isDown) return;
    
    e.preventDefault();
    
    const x = e.pageX - container.offsetLeft;
    const y = e.pageY - container.offsetTop;
    const walkX = (x - state.startX) * sensitivity;
    const walkY = (y - state.startY) * sensitivity;
    
    container.scrollLeft = state.scrollLeft - walkX;
    container.scrollTop = state.scrollTop - walkY;
    
    // 속도 계산 (관성 스크롤용)
    const now = Date.now();
    const dt = now - state.lastTime;
    if (dt > 0) {
      state.velocityX = (state.lastX - e.pageX) * sensitivity * (16 / dt);
      state.velocityY = (state.lastY - e.pageY) * sensitivity * (16 / dt);
    }
    
    state.lastX = e.pageX;
    state.lastY = e.pageY;
    state.lastTime = now;
  }, [sensitivity]);

  // 마우스 나감
  const handleMouseLeave = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    
    if (dragState.current.isDown) {
      dragState.current.isDown = false;
      setIsDragging(false);
      container.style.cursor = 'grab';
      container.style.userSelect = '';
    }
  }, []);

  // 이벤트 리스너 등록/해제
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    container.style.cursor = 'grab';
    
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);
    
    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
      
      if (dragState.current.animationId) {
        cancelAnimationFrame(dragState.current.animationId);
      }
    };
  }, [handleMouseDown, handleMouseUp, handleMouseMove, handleMouseLeave]);

  return {
    containerRef,
    isDragging,
  };
}

