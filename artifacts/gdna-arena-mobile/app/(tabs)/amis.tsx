import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, I18nManager, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@workspace/gdna-ds/components/native/button';
import { Card } from '@workspace/gdna-ds/components/native/card';
import { Empty } from '@workspace/gdna-ds/components/native/empty';
import { Input } from '@workspace/gdna-ds/components/native/input';
import { Spinner } from '@workspace/gdna-ds/components/native/spinner';
import { Typography } from '@workspace/gdna-ds/components/native/typography';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import {
  enrollDeviceIdentity,
  ensureDeviceIdentity,
  getCurrentDeviceId,
  getDevices,
  revokeDevice,
} from '@/lib/e2e';
import { AgoraSurface, useAgoraCalls } from '@/lib/agora-calls';
import { NightCallControls } from '@/components/NightCallControls';
import { useAuth } from '@/contexts/AuthContext';
import { useOnline } from '@/contexts/OnlineContext';
import { enablePush, disablePush, pushEnabled } from '@/lib/native-push';

const sections = ['Chats', 'Calls', 'Communities', 'Settings'] as const;
type Section = typeof sections[number];
type Room = { id:number; name?:string|null; type:string; unreadCount?:number; muted?:boolean; members?:{userId:number;username?:string;online?:boolean}[]; lastMessage?:{content?:string|null} };
const pushCopy = {
  ar: { label: 'تنبيهات الهاتف (الرسائل والمكالمات)', note: 'اختياري؛ فتح التنبيه لا يرد على المكالمة، ولا يدعم الرنين الأصلي. يتطلب التسليم معرّف مشروع Expo وبيانات APNs/FCM في التطبيق المثبّت.' },
  en: { label: 'Phone alerts (messages and calls)', note: 'Optional; opening an alert never answers a call. Native ringing is not supported. Delivery requires an Expo project ID and APNs/FCM credentials in the installed build.' },
  fr: { label: 'Alertes du téléphone (messages et appels)', note: 'Facultatif ; ouvrir une alerte ne répond pas à un appel. Sonnerie native non prise en charge. La livraison exige un projet Expo et des identifiants APNs/FCM.' },
  es: { label: 'Alertas del teléfono (mensajes y llamadas)', note: 'Opcional; abrir una alerta no contesta llamadas. Sin timbre nativo. La entrega requiere un proyecto Expo y credenciales APNs/FCM.' },
  de: { label: 'Telefonbenachrichtigungen (Nachrichten und Anrufe)', note: 'Optional; das Öffnen nimmt keinen Anruf an. Kein natives Klingeln. Für die Zustellung sind eine Expo-Projekt-ID und APNs/FCM-Zugangsdaten erforderlich.' },
} as const;

export default function AmisScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>(params.section === 'Calls' ? 'Calls' : 'Chats');
  useEffect(() => { if (params.section === 'Calls') setSection('Calls'); }, [params.section]);
  const calls = useAgoraCalls(user, () => setSection('Calls'));
  const sectionIndex = sections.indexOf(section);
  useEffect(() => {
    if (user) void ensureDeviceIdentity(user).catch(() => undefined);
  }, [user]);
  const pan = Gesture.Pan().activeOffsetX([-34, 34]).failOffsetY([-20, 20]).onEnd(event => {
    const logical = event.translationX * (I18nManager.isRTL ? 1 : -1);
    if (Math.abs(logical) < 84 || Math.abs(event.velocityX) < 220) return;
    const next = Math.max(0, Math.min(sections.length - 1, sectionIndex + (logical > 0 ? 1 : -1)));
    setSection(sections[next]);
  }).runOnJS(true);
  return <View style={[styles.root, {
    backgroundColor: colors.background,
    paddingTop: insets.top,
    direction: I18nManager.isRTL ? 'rtl' : 'ltr',
  }]}>
    <GestureDetector gesture={pan}><View><Typography variant="title" style={styles.title}>AMIS</Typography></View></GestureDetector>
    <View accessibilityRole="tablist" style={[styles.tabs, {
      borderColor: colors.border,
      flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    }]}>
      {sections.map(item => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: item === section }}
        onPress={() => setSection(item)} style={[styles.tab, item === section && { borderBottomColor: colors.primary }]}>
        <Typography variant={item === section ? 'label' : 'muted'}>{item}</Typography>
      </Pressable>)}
    </View>
    <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {section === 'Chats' && <Chats />}
      {section === 'Calls' && <Calls controller={calls} />}
      {section === 'Communities' && <Communities />}
      {section === 'Settings' && <Settings />}
    </View>
  </View>;
}

function QueryState({ loading, error, retry, empty, children }: { loading:boolean; error:unknown; retry:()=>void; empty:boolean; children:React.ReactNode }) {
  if (loading) return <View style={styles.center}><Spinner /></View>;
  if (error) return <Empty><Typography variant="muted">{error instanceof Error ? error.message : 'Unable to load AMIS.'}</Typography><Button onPress={retry}>Retry</Button></Empty>;
  if (empty) return <Empty><Typography variant="muted">Nothing here yet.</Typography></Empty>;
  return <>{children}</>;
}

function Chats() {
  const colors = useColors(); const router = useRouter(); const client = useQueryClient();
  const { user } = useAuth();
  const { isOnline } = useOnline();
  const [search, setSearch] = useState(''); const [username, setUsername] = useState('');
  const rooms = useQuery({ queryKey:['amis-rooms', user?.id], enabled:!!user, queryFn:()=>apiGet<{rooms:Room[]}>('/messages/rooms') });
  const create = useMutation({ mutationFn:()=>apiPost<{room:Room}>('/messages/rooms',{targetUsername:username.trim(),type:'direct'}),
    onSuccess: result => { setUsername(''); client.invalidateQueries({queryKey:['amis-rooms', user?.id]}); router.push({ pathname:'/conversation/[roomId]' as never, params:{roomId:result.room.id} }); } });
  const filtered = useMemo(() => (rooms.data?.rooms ?? []).filter(room => `${room.name ?? ''} ${room.members?.map(x=>x.username).join(' ')}`.toLowerCase().includes(search.toLowerCase())), [rooms.data, search]);
  return <View style={styles.fill}><Input value={search} onChangeText={setSearch} placeholder="Search conversations" />
    <View style={styles.newRow}><Input value={username} onChangeText={setUsername} placeholder="Citizen username" style={styles.grow}/><Button loading={create.isPending} disabled={!isOnline || !username.trim()} onPress={()=>create.mutate()}>New chat</Button></View>
    {create.error && <Typography variant="muted">{create.error instanceof Error ? create.error.message : 'Could not start chat.'}</Typography>}
    <QueryState loading={rooms.isLoading} error={rooms.error} retry={rooms.refetch} empty={!filtered.length}><FlatList data={filtered} keyExtractor={x=>String(x.id)} contentContainerStyle={styles.list} renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel="Open conversation" onPress={()=>router.push(`/conversation/${item.id}` as never)}><Card style={styles.card}><View style={styles.row}><Typography variant="label" style={styles.grow}>{item.name ?? item.members?.find(x=>x.username)?.username ?? 'Secure conversation'}</Typography>{item.muted && <Typography variant="muted">Muted</Typography>}{!!item.unreadCount && <Typography style={{color:colors.primary}}>{item.unreadCount}</Typography>}</View><Typography variant="muted" numberOfLines={1}>{item.lastMessage?.content?.startsWith('e2e:v1:')?'Encrypted message':item.lastMessage?.content ?? 'No messages'}</Typography></Card></Pressable>} /></QueryState>
  </View>;
}

function Calls({ controller }: { controller: ReturnType<typeof useAgoraCalls> }) {
  const colors = useColors();
  const { user } = useAuth();
  const { isOnline } = useOnline();
  const [username,setUsername]=useState(''); const [video,setVideo]=useState(false);
  const calls=useQuery({queryKey:['amis-calls',user?.id],enabled:!!user,queryFn:()=>apiGet<{records:{id:number;callerUsername:string;calleeUsername:string;callType:string;status:string;durationSec:number}[]}>('/social/v2/call-history')});
  const active=controller.call;
  return <View style={styles.fill}><Card style={styles.card}><Typography variant="label">Secure Agora calls</Typography><Typography variant="muted">Audio and video are protected with mandatory AES-256-GCM2 encryption.</Typography>
    {active ? <><Typography variant="label">{active.incoming&&active.phase==='incoming'?'Incoming from':'Call with'} {active.peer}</Typography><Typography variant="muted">{active.video?'Video':'Audio'} · {active.phase}</Typography>
      {active.video&&<View style={[styles.videoStage,{backgroundColor:colors.background}]}>{active.remoteUid!==undefined&&<AgoraSurface uid={active.remoteUid} style={StyleSheet.absoluteFill}/>}<AgoraSurface uid={0} local style={styles.localVideo}/></View>}
      {active.video&&active.phase!=='incoming'&&<NightCallControls callId={active.callId}/>}
      {active.phase==='incoming'?<View style={styles.row}><Button style={styles.grow} disabled={!isOnline} onPress={controller.answer}>Answer</Button><Button style={styles.grow} variant="destructive" disabled={!isOnline} onPress={controller.reject}>Reject</Button></View>:<Button variant="destructive" disabled={!isOnline} onPress={controller.end}>End call</Button>}
    </>:<><Input value={username} onChangeText={setUsername} placeholder="Citizen username" /><View style={styles.row}><Typography variant="muted" style={styles.grow}>Video</Typography><Switch value={video} disabled={!isOnline} onValueChange={setVideo}/></View><Button disabled={!isOnline || !username.trim()} onPress={()=>controller.start(username.trim(),video).catch(error=>Alert.alert('Call unavailable',error instanceof Error?error.message:'Could not start call.'))}>{`Start ${video?'video':'audio'} call`}</Button></>}
    <Button variant="outline" disabled={!isOnline || !!active} onPress={()=>controller.testConnection()}>Test Agora connection</Button>
    {controller.preflight&&<Typography variant="muted">{controller.preflight}</Typography>}{controller.error&&<Typography variant="muted">{controller.error}</Typography>}</Card>
    <QueryState loading={calls.isLoading} error={calls.error} retry={calls.refetch} empty={!calls.data?.records.length}><FlatList data={calls.data?.records??[]} keyExtractor={x=>String(x.id)} renderItem={({item})=><Card style={styles.card}><Typography>{item.callerUsername} → {item.calleeUsername}</Typography><Typography variant="muted">{item.callType} · {item.status} · {item.durationSec}s</Typography></Card>}/></QueryState></View>;
}

function Communities() {
  const client=useQueryClient(); const router=useRouter(); const [scope,setScope]=useState<'empire'|number>('empire'); const [groupName,setGroupName]=useState('');
  const { user } = useAuth();
  const { isOnline } = useOnline();
  const groups=useQuery({queryKey:['amis-communities',user?.id],enabled:!!user,queryFn:()=>apiGet<{communities:{id:number;name:string;memberCount:number;activeInitiativeCount:number}[]}>('/messages/communities')});
  const rooms=useQuery({queryKey:['amis-rooms',user?.id],enabled:!!user,queryFn:()=>apiGet<{rooms:Room[]}>('/messages/rooms')});
  const memberIds=useMemo(()=>new Set((rooms.data?.rooms??[]).filter(room=>room.type==='group').map(room=>room.id)),[rooms.data]);
  const relay=useQuery({queryKey:['amis-relay',user?.id,scope],enabled:!!user,queryFn:()=>apiGet<{initiatives:{id:number;title:string;body:string;domain:string;roomId:number|null;roomName?:string;supportCount:number;targetSupport:number;supportedByMe:boolean;status:string}[]}>(`/solidarity/initiatives${scope==='empire'?'':`?roomId=${scope}`}`)});
  const join=useMutation({mutationFn:(id:number)=>apiPost(`/messages/rooms/${id}/join`),onSuccess:(_,id)=>{client.invalidateQueries({queryKey:['amis-rooms',user?.id]});client.invalidateQueries({queryKey:['amis-communities',user?.id]});router.push(`/conversation/${id}` as never);}});
  const create=useMutation({mutationFn:()=>apiPost<{room:Room}>('/messages/rooms',{roomName:groupName.trim(),type:'group',icon:'💬'}),onSuccess:result=>{setGroupName('');client.invalidateQueries({queryKey:['amis-rooms',user?.id]});client.invalidateQueries({queryKey:['amis-communities',user?.id]});router.push(`/conversation/${result.room.id}` as never);}});
  const support=useMutation({mutationFn:(id:number)=>apiPost(`/solidarity/initiatives/${id}/support`),onSuccess:()=>client.invalidateQueries({queryKey:['amis-relay',user?.id]})});
  const unsupport=useMutation({mutationFn:(id:number)=>apiDelete(`/solidarity/initiatives/${id}/support`),onSuccess:()=>client.invalidateQueries({queryKey:['amis-relay',user?.id]})});
  const items=[...(groups.data?.communities??[]).map(x=>({kind:'group' as const,x})),...(relay.data?.initiatives??[]).map(x=>({kind:'relay' as const,x}))];
  return <FlatList data={items} contentContainerStyle={styles.list} ListHeaderComponent={<View style={styles.card}><Typography variant="label">Communities · Solidarity Relay</Typography><View style={styles.newRow}><Input value={groupName} onChangeText={setGroupName} placeholder="New community name" style={styles.grow}/><Button size="sm" loading={create.isPending} disabled={!isOnline || !groupName.trim()} onPress={()=>create.mutate()}>Create</Button></View>{create.error&&<Typography variant="muted">{create.error instanceof Error?create.error.message:'Could not create community.'}</Typography>}<View style={styles.wrap}><Button size="sm" variant={scope==='empire'?'default':'outline'} onPress={()=>setScope('empire')}>Empire</Button>{(groups.data?.communities??[]).filter(x=>memberIds.has(x.id)).map(group=><Button key={group.id} size="sm" variant={scope===group.id?'default':'outline'} onPress={()=>setScope(group.id)}>{group.name}</Button>)}</View></View>} keyExtractor={i=>`${i.kind}-${i.x.id}`} renderItem={({item})=>item.kind==='group'?<Card style={styles.card}><Typography variant="label">{item.x.name}</Typography><Typography variant="muted">{item.x.memberCount} members · {item.x.activeInitiativeCount} initiatives</Typography><Button size="sm" disabled={!isOnline} loading={join.isPending} onPress={()=>memberIds.has(item.x.id)?router.push(`/conversation/${item.x.id}` as never):join.mutate(item.x.id)}>{memberIds.has(item.x.id)?'Open conversation':'Join group'}</Button></Card>:<Card style={styles.card}><Typography variant="label">{item.x.title}</Typography><Typography variant="muted">{item.x.domain}{item.x.roomName?` · ${item.x.roomName}`:' · Empire'}</Typography><Typography variant="muted">{item.x.body}</Typography><Button size="sm" variant={item.x.supportedByMe?'outline':'default'} disabled={!isOnline || item.x.status!=='open'} loading={support.isPending||unsupport.isPending} onPress={()=>item.x.supportedByMe?unsupport.mutate(item.x.id):support.mutate(item.x.id)}>{`${item.x.supportedByMe?'Unsupport':'Support'} · ${item.x.supportCount}/${item.x.targetSupport}`}</Button></Card>}/>;
}

function Settings() {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2);
  const phoneText = pushCopy[locale as keyof typeof pushCopy] ?? pushCopy.ar;
  const {user}=useAuth(); const client=useQueryClient(); const [currentId,setCurrentId]=useState<string|null>(null); const settings=useQuery({queryKey:['amis-settings',user?.id],enabled:!!user,queryFn:()=>apiGet<{notifications:boolean;readReceipts:boolean}>('/messages/settings')}); const devices=useQuery({queryKey:['amis-devices',user?.id],enabled:!!user,queryFn:getDevices});
  const [phonePush, setPhonePush] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  useEffect(() => { let active = true; setPhonePush(false); if (user) void pushEnabled(user.id).then(value => { if (active) setPhonePush(value); }); return () => { active = false; }; }, [user?.id]);
  const togglePush = async (value: boolean) => {
    if (!user) return;
    setPushBusy(true); setPushError(null);
    try {
      if (value) await enablePush(user.id); else await disablePush(user.id);
      setPhonePush(value);
    } catch (error) {
      setPushError(error instanceof Error ? error.message : 'Phone notifications could not be changed.');
    } finally { setPushBusy(false); }
  };
  const { isOnline } = useOnline();
  useEffect(()=>{if(user)Promise.all([getCurrentDeviceId(user.id),SecureStore.getItemAsync(`gdna.e2e.revoked.v1.${user.id}`)]).then(([device,revoked])=>setCurrentId(device??revoked)).catch(()=>undefined);},[user]);
  const save=useMutation({mutationFn:(body:{notifications?:boolean;readReceipts?:boolean})=>apiPost('/messages/settings',body),onSuccess:()=>client.invalidateQueries({queryKey:['amis-settings',user?.id]})});
  const revoke=useMutation({mutationFn:async(deviceId:string)=>{
    if(!user)throw new Error('Sign in required');
    await revokeDevice(deviceId,user.id);
  },onSuccess:(_,id)=>{client.invalidateQueries({queryKey:['amis-devices',user?.id]});if(id===currentId)setCurrentId(id);}});
  const reenroll=useMutation({mutationFn:async()=>{if(!user)throw new Error('Sign in required');return enrollDeviceIdentity(user);},onSuccess:identity=>{setCurrentId(identity.deviceId);client.invalidateQueries({queryKey:['amis-devices',user?.id]});}});
  const currentPresent=!!currentId&&!!devices.data?.devices.some(x=>x.deviceId===currentId);
  return <FlatList data={devices.data?.devices??[]} contentContainerStyle={styles.list} keyExtractor={x=>x.deviceId} ListHeaderComponent={<><Card style={styles.card}><Typography variant="label">Privacy</Typography><View style={styles.row}><Typography style={styles.grow}>Notifications</Typography><Switch value={settings.data?.notifications??false} disabled={!isOnline} onValueChange={value=>save.mutate({notifications:value})}/></View><View style={styles.row}><Typography style={styles.grow}>{phoneText.label}</Typography><Switch testID="phone-push-toggle" value={phonePush} disabled={!isOnline||pushBusy} onValueChange={value=>void togglePush(value)}/></View><Typography variant="muted">{phoneText.note}</Typography>{pushError&&<Typography variant="muted">{pushError}</Typography>}<View style={styles.row}><Typography style={styles.grow}>Read receipts</Typography><Switch value={settings.data?.readReceipts??false} disabled={!isOnline} onValueChange={value=>save.mutate({readReceipts:value})}/></View></Card>{currentId&&!currentPresent&&<Card style={styles.card}><Typography variant="label">This device key was revoked</Typography><Typography variant="muted">Explicitly re-enroll this device before receiving encrypted messages or calls.</Typography><Button disabled={!isOnline} loading={reenroll.isPending} onPress={()=>reenroll.mutate()}>Re-enroll this device</Button></Card>}</>} renderItem={({item})=><Card style={styles.card}><Typography variant="label">Secure device {item.deviceId===currentId?'· This device':''}</Typography><Typography variant="muted" selectable>{item.deviceId} · {item.fingerprint}</Typography><Button size="sm" variant="destructive" disabled={!isOnline} accessibilityLabel={`Revoke device ${item.deviceId}`} onPress={()=>Alert.alert('Revoke device?','It will stop receiving new encrypted messages and calls.',[{text:'Cancel',style:'cancel'},{text:'Revoke',style:'destructive',onPress:()=>revoke.mutate(item.deviceId)}])}>Revoke</Button></Card>}/>;
}
const styles=StyleSheet.create({root:{flex:1},title:{paddingHorizontal:16,paddingVertical:10,textAlign:'auto',writingDirection:'auto'},tabs:{borderBottomWidth:1},tab:{flex:1,alignItems:'center',padding:12,borderBottomWidth:2,borderBottomColor:'transparent'},content:{flex:1,padding:12},fill:{flex:1,gap:10},list:{gap:10,paddingVertical:10},card:{gap:8},row:{flexDirection:'row',alignItems:'center',gap:8},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},grow:{flex:1},newRow:{flexDirection:'row',gap:8},center:{flex:1,alignItems:'center',justifyContent:'center'},videoStage:{height:260,overflow:'hidden',borderRadius:12},localVideo:{position:'absolute',width:96,height:128,end:8,bottom:8,borderRadius:8}});