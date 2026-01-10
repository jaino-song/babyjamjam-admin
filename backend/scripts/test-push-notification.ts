/**
 * PWA Push Notification Test Script
 *
 * 사용법:
 * 1. 먼저 프론트엔드에서 알림을 구독하세요
 * 2. npx ts-node scripts/test-push-notification.ts
 *
 * 환경 변수 필요:
 * - VAPID_PUBLIC_KEY
 * - VAPID_PRIVATE_KEY
 * - VAPID_EMAIL
 */

import webpush from 'web-push';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const vapidPublicKey = process.env['VAPID_PUBLIC_KEY']!;
const vapidPrivateKey = process.env['VAPID_PRIVATE_KEY']!;
const vapidEmail = process.env['VAPID_EMAIL']!;

const prisma = new PrismaClient();

async function testPushNotification() {
  console.log('🔔 PWA Push Notification Test\n');

  // VAPID 설정 확인
  console.log('1. VAPID 설정 확인...');
  if (!vapidPublicKey || !vapidPrivateKey || !vapidEmail) {
    console.error('❌ VAPID 환경 변수가 설정되지 않았습니다.');
    console.log('필요한 환경 변수: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL');
    process.exit(1);
  }
  console.log('✅ VAPID 설정 완료\n');

  // web-push 초기화
  webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublicKey, vapidPrivateKey);

  // Prisma에서 구독 정보 조회
  console.log('2. 구독된 사용자 조회...');

  try {
    const subscriptions = await prisma.push_subscription.findMany({
      take: 10,
    });

    if (!subscriptions || subscriptions.length === 0) {
      console.log('⚠️  구독된 사용자가 없습니다.');
      console.log('\n📱 테스트 방법:');
      console.log('1. 프론트엔드 앱을 열고 로그인하세요');
      console.log('2. 설정에서 "알림 받기"를 활성화하세요');
      console.log('3. 이 스크립트를 다시 실행하세요\n');
      await prisma.$disconnect();
      process.exit(0);
    }

    console.log(`✅ ${subscriptions.length}개의 구독 발견\n`);

    // 테스트 알림 전송
    console.log('3. 테스트 알림 전송 중...\n');

    const payload = JSON.stringify({
      title: '🎉 테스트 알림',
      body: 'PWA 푸시 알림이 정상 작동합니다!',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      data: {
        url: '/dashboard',
        timestamp: new Date().toISOString(),
      },
    });

    let successCount = 0;
    let failCount = 0;

    for (const sub of subscriptions) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh_key,
          auth: sub.auth_key,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, payload);
        console.log(`✅ 전송 성공 - User: ${sub.user_id}`);
        successCount++;
      } catch (err: unknown) {
        const error = err as { statusCode?: number; message?: string };
        console.log(`❌ 전송 실패 - User: ${sub.user_id}`);
        console.log(`   Error: ${error.statusCode || error.message}`);

        // 410 Gone - 만료된 구독 삭제
        if (error.statusCode === 410 || error.statusCode === 404) {
          console.log('   → 만료된 구독을 삭제합니다...');
          await prisma.push_subscription.delete({
            where: { id: sub.id },
          });
        }
        failCount++;
      }
    }

    console.log('\n📊 결과:');
    console.log(`   성공: ${successCount}개`);
    console.log(`   실패: ${failCount}개`);
    console.log('\n✨ 테스트 완료!');
  } catch (error) {
    console.error('❌ 오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testPushNotification().catch(console.error);
