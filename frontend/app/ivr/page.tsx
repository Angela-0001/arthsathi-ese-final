/**
 * ArthSathi — IVR / Call Us Page
 * 
 * Phone access information for feature phone users
 */

'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { t, initLanguage } from '@/i18n';

const IVR_NUMBER = process.env.NEXT_PUBLIC_IVR_NUMBER || '02248963501';

export default function IVRPage() {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    initLanguage();
    setMounted(true);
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(IVR_NUMBER).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!mounted) return null;

  return (
    <main className="min-h-screen bg-surface py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="text-5xl mb-4">📞</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            {t('ivr.title') || 'Call Us (IVR)'}
          </h1>
          <p className="text-lg text-gray-600">
            {t('ivr.subtitle') || 'Get scheme recommendations over phone'}
          </p>
        </div>

        {/* Call Now Card */}
        <Card shadow="lg" padding="lg" className="text-center mb-8">
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-14 h-14 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>

          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            {IVR_NUMBER}
          </h2>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
            <Button 
              variant="primary" 
              size="lg"
              onClick={() => window.location.href = `tel:${IVR_NUMBER}`}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {t('ivr.call_now') || 'Call Now'}
            </Button>

            <Button 
              variant="ghost" 
              size="lg"
              onClick={handleCopy}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {copied ? (t('ivr.copied') || 'Copied!') : (t('ivr.copy_number') || 'Copy Number')}
            </Button>
          </div>

          <p className="text-sm text-gray-500">
            {t('ivr.toll_info') || 'Standard call charges apply'}
          </p>
        </Card>

        {/* How it Works */}
        <Card className="mb-8">
          <h3 className="text-2xl font-bold text-gray-900 mb-6">
            {t('ivr.how_it_works') || 'How It Works'}
          </h3>

          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">
                  {t('ivr.step_1_title') || 'Choose Your Language'}
                </h4>
                <p className="text-gray-600">
                  {t('ivr.step_1_desc') || 'Press 1 for Hindi, 2 for Marathi, 3 for Tamil, 4 for Telugu, 5 for Bengali, 6 for English'}
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center font-bold">
                2
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">
                  {t('ivr.step_2_title') || 'Answer Questions'}
                </h4>
                <p className="text-gray-600">
                  {t('ivr.step_2_desc') || 'Use your phone keypad to answer simple questions about your age, occupation, and income'}
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center font-bold">
                3
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">
                  {t('ivr.step_3_title') || 'Hear Recommendations'}
                </h4>
                <p className="text-gray-600">
                  {t('ivr.step_3_desc') || 'Listen to scheme recommendations read aloud in your selected language'}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Languages Supported */}
        <Card className="bg-blue-50 border-blue-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">
            {t('ivr.languages_title') || 'Languages Supported'}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { code: '1', name: 'हिंदी', label: 'Hindi' },
              { code: '2', name: 'मराठी', label: 'Marathi' },
              { code: '3', name: 'தமிழ்', label: 'Tamil' },
              { code: '4', name: 'తెలుగు', label: 'Telugu' },
              { code: '5', name: 'বাংলা', label: 'Bengali' },
              { code: '6', name: 'English', label: 'English' },
            ].map((lang) => (
              <div key={lang.code} className="bg-white rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600 mb-1">{lang.code}</div>
                <div className="text-sm font-medium text-gray-900">{lang.name}</div>
                <div className="text-xs text-gray-500">{lang.label}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}
