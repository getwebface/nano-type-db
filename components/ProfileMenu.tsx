import React, { useState, useRef, useEffect } from 'react';
import { authClient } from '../src/lib/auth-client';
import { 
  User, 
  Settings, 
  CreditCard, 
  LogOut, 
  Calendar,
  Crown,
  ChevronDown,
  TrendingUp
} from 'lucide-react';

interface ProfileMenuProps {
  userTier?: string;
}

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ userTier = 'free' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: session } = authClient.useSession();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await authClient.signOut();
    window.location.reload();
  };

  const user = session?.user;
  if (!user) return null;
  
  // Initialize display name from user data
  useEffect(() => {
    if (user.name && !displayName) {
      setDisplayName(user.name);
    }
  }, [user.name, displayName]);

  // Calculate account age
  const accountCreatedAt = user.createdAt ? new Date(user.createdAt) : new Date();
  const daysSinceJoined = Math.floor((Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24));
  
  // Format days since joined
  const formatDaysSince = (days: number) => {
    if (days === 0) return 'Joined today';
    if (days === 1) return 'Joined yesterday';
    return `Joined ${days} days ago`;
  };
  
  // Get user initials for avatar
  const initials = user.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
    : user.email?.substring(0, 2).toUpperCase() || 'U';

  const isPro = userTier === 'pro';

  return (
    <div className="relative" ref={menuRef}>
      {/* Profile Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800 transition-all duration-200 group"
      >
        {/* Profile Image or Initials */}
        <div className="relative">
          {user.image ? (
            <img 
              src={user.image} 
              alt={user.name || 'User'} 
              className="w-8 h-8 rounded-full ring-2 ring-slate-700 group-hover:ring-slate-600 transition-all duration-200"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold ring-2 ring-slate-700 group-hover:ring-slate-600 transition-all duration-200">
              {initials}
            </div>
          )}
          {isPro && (
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center ring-2 ring-slate-900">
              <Crown size={10} className="text-slate-900" />
            </div>
          )}
        </div>
        
        <ChevronDown 
          size={16} 
          className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* User Info Section */}
          <div className="p-4 border-b border-slate-800 bg-gradient-to-br from-slate-900 to-slate-800">
            <div className="flex items-center gap-3 mb-3">
              {user.image ? (
                <img 
                  src={user.image} 
                  alt={user.name || 'User'} 
                  className="w-12 h-12 rounded-full ring-2 ring-slate-700"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-lg font-bold ring-2 ring-slate-700">
                  {initials}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-semibold truncate">{user.name || 'User'}</h3>
                <p className="text-slate-400 text-sm truncate">{user.email}</p>
              </div>
            </div>
            
            {/* Tier Badge */}
            <div className="flex items-center gap-2">
              <div className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${
                isPro 
                  ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-slate-900' 
                  : 'bg-slate-800 text-slate-300'
              }`}>
                {isPro && <Crown size={12} />}
                {isPro ? 'Pro Plan' : 'Free Plan'}
              </div>
              <div className="flex items-center gap-1 text-slate-400 text-xs">
                <Calendar size={12} />
                <span>{formatDaysSince(daysSinceJoined)}</span>
              </div>
            </div>
          </div>

          {/* Stats Section - Delight Feature */}
          <div className="grid grid-cols-2 gap-2 p-4 border-b border-slate-800 bg-slate-900/50">
            <div className="bg-slate-800/50 rounded-lg p-3 hover:bg-slate-800 transition-colors duration-200 cursor-default">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <TrendingUp size={12} />
                <span>Activity</span>
              </div>
              <p className="text-white text-lg font-bold">Active</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3 hover:bg-slate-800 transition-colors duration-200 cursor-default">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Calendar size={12} />
                <span>Member Since</span>
              </div>
              <p className="text-white text-sm font-semibold">
                {accountCreatedAt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Menu Items */}
          <div className="p-2">
            <button
              onClick={() => {
                setShowSettings(!showSettings);
                setShowBilling(false);
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-all duration-200 group"
            >
              <Settings size={16} className="group-hover:rotate-90 transition-transform duration-300" />
              <span className="text-sm">Profile Settings</span>
            </button>

            <button
              onClick={() => {
                setShowBilling(!showBilling);
                setShowSettings(false);
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-all duration-200 group"
            >
              <CreditCard size={16} className="group-hover:scale-110 transition-transform duration-200" />
              <span className="text-sm">Billing & Subscription</span>
            </button>

            <div className="border-t border-slate-800 my-2"></div>

            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-900/20 text-slate-300 hover:text-red-400 transition-all duration-200 group"
            >
              <LogOut size={16} className="group-hover:translate-x-1 transition-transform duration-200" />
              <span className="text-sm">Sign Out</span>
            </button>
          </div>

          {/* Settings Panel */}
          {showSettings && (
            <div className="border-t border-slate-800 bg-slate-950 p-4 animate-in slide-in-from-top-2 duration-200">
              <h4 className="text-white font-semibold mb-3 text-sm">Profile Settings</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Display Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-200"
                    placeholder="Enter your name"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Email</label>
                  <input
                    type="email"
                    value={user.email || ''}
                    disabled
                    className="w-full bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
                  />
                </div>
                <button 
                  onClick={() => {
                    // TODO: Implement profile update API call
                    console.log('Saving profile changes:', { displayName });
                    // This would call an API endpoint to update the user profile
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm py-2 rounded-lg transition-colors duration-200"
                >
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {/* Billing Panel */}
          {showBilling && (
            <div className="border-t border-slate-800 bg-slate-950 p-4 animate-in slide-in-from-top-2 duration-200">
              <h4 className="text-white font-semibold mb-3 text-sm">Billing & Subscription</h4>
              
              {isPro ? (
                <div className="space-y-3">
                  <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Crown size={16} className="text-yellow-500" />
                      <span className="text-yellow-500 font-semibold text-sm">Pro Plan Active</span>
                    </div>
                    <p className="text-slate-300 text-xs mb-2">
                      Enjoy unlimited databases, advanced features, and priority support.
                    </p>
                    <p className="text-slate-400 text-xs">
                      {/* TODO: Fetch real billing date from subscription data */}
                      Next billing date: {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}
                    </p>
                  </div>
                  <button 
                    onClick={() => {
                      // TODO: Navigate to subscription management page
                      console.log('Navigate to subscription management');
                    }}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm py-2 rounded-lg transition-colors duration-200"
                  >
                    Manage Subscription
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <p className="text-slate-300 text-sm mb-3">
                      You're currently on the <span className="font-semibold text-white">Free Plan</span>
                    </p>
                    <div className="space-y-2 mb-3">
                      <div className="flex items-center gap-2 text-slate-400 text-xs">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                        <span>Limited to 3 databases</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400 text-xs">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                        <span>Basic features only</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      // TODO: Navigate to upgrade/payment page
                      console.log('Navigate to upgrade flow');
                    }}
                    className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-slate-900 font-semibold text-sm py-2 rounded-lg transition-all duration-200 transform hover:scale-[1.02]"
                  >
                    Upgrade to Pro
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
