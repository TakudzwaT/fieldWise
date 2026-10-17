import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme/app_theme.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/ui/badges.dart';
import '../../core/ui/buttons.dart';
import '../../core/ui/crop_imagery.dart';
import '../../core/ui/layout.dart';
import '../../core/utils/dates.dart';
import '../home/widgets/home_sections.dart';
import '../home/widgets/zone_carousel.dart';
import '../shell/almanac_scaffold.dart';
import '../shell/bottom_nav_island.dart';
import 'fieldwise_api.dart';

/// The officer experience uses Farmable's shell and cards. Farm locations and
/// reports are local scenario data; weather and mapped soil are refreshed when
/// their public services are available.
class FelixApp extends StatelessWidget {
  const FelixApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Fieldwise',
    debugShowCheckedModeBanner: false,
    theme: almanacLightTheme(),
    darkTheme: almanacDarkTheme(),
    themeMode: ThemeMode.system,
    home: const _Workspace(),
  );
}

class _Farm {
  _Farm(
    this.id,
    this.name,
    this.point,
    this.crop,
    this.clay,
    this.rain,
    this.heat,
  );

  final String id;
  final String name;
  final LatLng point;
  String crop;
  double clay; // SoilGrids 0–5 cm estimate, percent.
  double rain; // Forecast precipitation over the next three days, mm.
  double heat; // Highest forecast temperature over the next three days, °C.
  bool soilLive = false;
  bool weatherLive = false;
  String? report;
  String? answers;
  DateTime? reportedAt;
  String? override;
  String? note;
  bool completed = false;
  bool planned = false;

  // Set while Felix is signed in to FieldWise: the server's priority list
  // (forecast flags scored by the farmers' own answers) replaces the local
  // drainage and heat rules below.
  bool live = false;
  FieldwiseLine? line;
  String? phone;
  String? ward;

  /// ussd (keypad phone: SMS and USSD), whatsapp, or sim (demo chat).
  String? channel;

  bool get wetFlag => soilLive && clay >= 35 && rain >= 25;
  bool get dryFlag => rain < 3 && heat >= 30;
  bool get concerningReport => report == 'Concern reported';
  int get score {
    if (completed || override == 'Already checked') return 0;
    if (live) {
      var value = switch (line?.rank) {
        'go_now' => 100,
        'this_week' => 80,
        'no_response' => 70,
        'recheck' => 60,
        'waiting' => 45,
        'none' => 15,
        _ => 10,
      };
      if (override == 'More urgent') value += 30;
      if (override == 'Call instead') value -= 20;
      return value;
    }
    var value = wetFlag
        ? 75
        : dryFlag
        ? 62
        : 25;
    if (concerningReport) value += 55;
    if (report == 'Conditions normal') value -= 15;
    if (override == 'More urgent') value += 30;
    if (override == 'Call instead') value -= 20;
    return value;
  }

  String get status => completed
      ? 'Completed'
      : override == 'Call instead'
      ? 'Call today'
      : live
      ? switch (line?.rank) {
          'go_now' => 'Visit today',
          'this_week' => 'Visit this week',
          'no_response' => 'No reply: call',
          'recheck' => 'Re-check',
          'waiting' => 'Waiting for farmer',
          'none' => 'No action',
          _ => 'Not flagged',
        }
      : score >= 75
      ? 'Visit today'
      : score >= 55
      ? 'Watch'
      : 'Routine';
  String get action {
    if (override == 'Call instead') return 'Call farmer';
    if (override == 'Different action' && note != null) return note!;
    if (live) return _liveAction;
    if (wetFlag) return 'Check drainage';
    if (dryFlag) return 'Check water stress';
    if (concerningReport) return 'Follow up report';
    return 'Routine follow-up';
  }

  String get why {
    if (live) return _liveWhy;
    if (report == 'Conditions normal' && wetFlag) {
      return 'The farmer reported no standing water. Forecast rain and mapped soil still warrant a follow-up after the rain.';
    }
    if (report == 'Conditions normal' && dryFlag) {
      return 'The farmer reported no current wilting. Keep watching during the forecast hot, dry period.';
    }
    if (concerningReport && wetFlag) {
      return 'The farmer reported standing water. Mapped clay-rich soil and forecast rain make a drainage check timely.';
    }
    if (concerningReport && dryFlag) {
      return 'The farmer reported crop stress while hot, dry weather is forecast.';
    }
    if (concerningReport) {
      return 'The farmer reported a condition that needs Felix to confirm it.';
    }
    if (wetFlag) {
      return 'Mapped clay-rich soil and forecast rain suggest a possible drainage concern.';
    }
    if (dryFlag) {
      return 'Hot weather with little forecast rain suggests checking for water stress.';
    }
    return 'No urgent concern from the current map and forecast information.';
  }

  String get success {
    if (live) {
      return line == null
          ? 'Record the crop condition and date of the next follow-up.'
          : 'Confirm what the farmer reported, record it, and send them advice.';
    }
    if (wetFlag) {
      return 'Record drainage and standing water before and after the forecast rain.';
    }
    if (dryFlag) {
      return 'Record visible stress and available water, then check again after action.';
    }
    return 'Record the crop condition and date of the next follow-up.';
  }

  String get _liveAction {
    final l = line;
    if (l == null) return 'Routine follow-up';
    return switch (l.rank) {
      'go_now' || 'this_week' =>
        l.answersSay.isEmpty
            ? 'Check the ${l.crop}'
            : 'Check for ${l.answersSay.join(' and ')}',
      'no_response' => 'Call farmer',
      'recheck' => 'Re-check at next forecast',
      'waiting' => "Wait for the farmer's answers",
      _ => 'No action needed',
    };
  }

  String get _liveWhy {
    final l = line;
    if (l == null) return 'The forecast does not flag this farm right now.';
    final who = l.source == 'farmer'
        ? 'The farmer reported a problem with their ${l.crop}.'
        : 'The forecast flagged ${l.flagged} on the ${l.crop}.';
    final say = l.answersSay.join(' and ');
    final answers = switch (l.outcome) {
      'confirmed_urgent' => 'Their answers confirm $say, and it is spreading.',
      'confirmed' => 'Their answers confirm $say.',
      'wrong_flag' => 'Their answers point to $say, not ${l.flagged}.',
      'early_signs' => 'Their answers show early signs only.',
      'clear' => 'Their answers show nothing wrong.',
      _ =>
        l.state == 'no_response'
            ? 'The farmer has not answered, even after a reminder.'
            : l.answered > 0
            ? 'The farmer has answered ${l.answered} of 8 questions so far.'
            : 'The farmer has not answered yet.',
    };
    return '$who $answers';
  }
}

String _cap(String value) =>
    value.isEmpty ? value : value[0].toUpperCase() + value.substring(1);

String _ago(DateTime at) {
  final minutes = DateTime.now().difference(at).inMinutes;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return '$minutes min ago';
  return '${minutes ~/ 60} h ago';
}

List<_Farm> _sampleFarms() => [
  _Farm(
    'F014',
    'Chimwemwe Farm',
    const LatLng(-13.0368, 33.4885),
    'Maize',
    0,
    0.9,
    30.75,
  ),
  _Farm(
    'F027',
    'Kasungu North',
    const LatLng(-13.0323, 33.4918),
    'Groundnuts',
    0,
    0.9,
    30.75,
  ),
  _Farm(
    'F043',
    'Mphatso Fields',
    const LatLng(-13.0407, 33.4932),
    'Maize',
    0,
    0.9,
    30.75,
  ),
  _Farm(
    'F056',
    'Banda Family Farm',
    const LatLng(-13.0430, 33.4855),
    'Tobacco',
    0,
    0.9,
    30.75,
  ),
  _Farm(
    'F062',
    'Riverbend Growers',
    const LatLng(-13.0334, 33.4858),
    'Vegetables',
    0,
    0.9,
    30.75,
  ),
  _Farm(
    'F075',
    'Central Harvest',
    const LatLng(-13.0389, 33.4961),
    'Maize',
    0,
    0.9,
    30.75,
  ),
  _Farm(
    'F084',
    'Dedza Road Farm',
    const LatLng(-13.0414, 33.4829),
    'Vegetables',
    0,
    0.9,
    30.75,
  ),
  _Farm(
    'F091',
    'Chulu Hills',
    const LatLng(-13.0304, 33.4954),
    'Groundnuts',
    0,
    0.9,
    30.75,
  ),
];

class _Workspace extends StatefulWidget {
  const _Workspace();

  @override
  State<_Workspace> createState() => _WorkspaceState();
}

class _WorkspaceState extends State<_Workspace> {
  final _farms = _sampleFarms();
  final _dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 5),
      receiveTimeout: const Duration(seconds: 5),
    ),
  );
  final _carousel = PageController(viewportFraction: .72);
  int _tab = 0;
  int _farmIndex = 0;
  String _filter = 'All';
  String _search = '';
  String? _selectedMapFarmId;
  final _events = <String>[];
  final _alerts = <String>[
    'Kasungu forecast: review farms exposed to heat and low rainfall.',
  ];
  final _offlineRoads = <Polyline>[];
  final _offlineRivers = <Polyline>[];
  String _forecastSource = 'FieldWise Kasungu forecast · 16 Oct';

  // FieldWise (apps/logic): Felix's live priority list, once he signs in.
  final _api = FieldwiseApi();
  final _callbacks = <FieldwiseCallback>[];
  List<FieldwiseAdvice> _advice = const [];
  Timer? _poll;
  bool _syncing = false;
  DateTime? _syncedAt;
  String? _syncError;

  bool get _live => _api.signedIn;

  @override
  void initState() {
    super.initState();
    _loadKasunguAssets();
    _connect();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _carousel.dispose();
    _dio.close();
    super.dispose();
  }

  Future<void> _connect() async {
    await _api.restore();
    if (!mounted) return;
    if (_live) {
      await _sync();
    } else {
      await _refreshData();
    }
    if (!mounted) return;
    _poll = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_live) _sync();
    });
  }

  /// Reads Felix's farmers, priority list and call-backs from FieldWise.
  Future<void> _sync() async {
    if (_syncing) return;
    _syncing = true;
    try {
      final snapshot = await _api.snapshot();
      if (_advice.isEmpty) {
        try {
          _advice = await _api.advice();
        } on FieldwiseException {
          // Felix can still write his own message.
        }
      }
      if (!mounted) return;
      setState(() => _apply(snapshot));
    } on FieldwiseException catch (error) {
      if (mounted) setState(() => _syncError = error.message);
    } finally {
      _syncing = false;
    }
  }

  void _apply(FieldwiseSnapshot snapshot) {
    if (snapshot.farmers.isEmpty) {
      _syncError = 'No farmers are assigned to you yet.';
      return;
    }
    final known = {for (final farm in _farms) farm.id: farm};
    final lines = {for (final line in snapshot.lines) line.farmerId: line};
    final farms = <_Farm>[];
    for (final farmer in snapshot.farmers) {
      final farm =
          known[farmer.id] ??
          _Farm(
            farmer.id,
            farmer.farmName ?? farmer.name,
            LatLng(farmer.latitude, farmer.longitude),
            'Mixed crops',
            0,
            0,
            0,
          );
      final line = lines[farmer.id];
      final before = farm.line;
      // Notify on what changed since the last look, not on the first load.
      if (farm.live && line != null) {
        if (line.rank == 'go_now' && before?.rank != 'go_now') {
          _alerts.insert(0, '${farm.name}: visit today. ${line.label}.');
        } else if (line.state == 'answered' && before?.state != 'answered') {
          _alerts.insert(0, '${farm.name}: the farmer answered. ${line.label}.');
        } else if (before == null) {
          _alerts.insert(
            0,
            line.source == 'farmer'
                ? '${farm.name}: the farmer reported a problem with their ${line.crop}.'
                : '${farm.name}: ${line.flagged} flagged. The farmer has been asked to check.',
          );
        }
      }
      farm
        ..live = true
        ..line = line
        ..phone = farmer.phone
        ..channel = farmer.channel
        ..ward = farmer.ward
        ..crop = line == null ? farm.crop : _cap(line.crop);
      farms.add(farm);
    }
    final waiting = {for (final callback in _callbacks) callback.id};
    if (_syncedAt != null) {
      for (final callback in snapshot.callbacks) {
        if (!waiting.contains(callback.id)) {
          _alerts.insert(0, '${callback.name} asked you to call them.');
        }
      }
    }
    _callbacks
      ..clear()
      ..addAll(snapshot.callbacks);
    _farms
      ..clear()
      ..addAll(farms);
    _syncedAt = DateTime.now();
    _syncError = null;
  }

  Future<void> _signIn() async {
    final code = await _askCode();
    if (code == null || code.isEmpty) return;
    try {
      final name = await _api.signIn(code);
      _message('Signed in as $name');
      await _sync();
    } on FieldwiseException catch (error) {
      _message(error.message);
    }
  }

  Future<void> _signOut() async {
    await _api.signOut();
    if (!mounted) return;
    setState(() {
      _farms
        ..clear()
        ..addAll(_sampleFarms());
      _callbacks.clear();
      _syncedAt = null;
      _syncError = null;
    });
    _message('Signed out. Showing offline demo data.');
    await _refreshData();
  }

  Future<String?> _askCode() async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign in to FieldWise'),
        content: TextField(
          controller: controller,
          autofocus: true,
          obscureText: true,
          decoration: const InputDecoration(
            hintText: 'Officer access code (fw_...)',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Sign in'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  Future<void> _call(String phone) async {
    try {
      await launchUrl(Uri(scheme: 'tel', path: phone));
    } catch (_) {
      _message('Call $phone');
    }
  }

  Future<void> _closeCallback(FieldwiseCallback callback) async {
    try {
      await _api.closeCallback(callback.id);
      setState(() {
        _callbacks.removeWhere((item) => item.id == callback.id);
        _events.insert(0, 'Called ${callback.name}');
      });
    } on FieldwiseException catch (error) {
      _message(error.message);
    }
  }

  /// A ready-made reply or Felix's own words, by SMS or WhatsApp.
  Future<void> _compose(_Farm farm) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          children: [
            Text(
              'Message ${farm.name}',
              style: Theme.of(ctx).textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            Text(
              farm.channel == 'ussd'
                  ? 'Goes by SMS to their keypad phone, in their language.'
                  : 'Goes by WhatsApp, in their language.',
            ),
            const SizedBox(height: 8),
            for (final advice in _advice)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(advice.label),
                subtitle: Text(advice.english),
                onTap: () => Navigator.pop(ctx, 'advice:${advice.id}'),
              ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(LucideIcons.notebookPen),
              title: const Text('Write my own'),
              onTap: () => Navigator.pop(ctx, 'text'),
            ),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;
    String? text;
    if (choice == 'text') {
      text = await _askNote('Message to ${farm.name}');
      if (text == null || text.isEmpty) return;
    }
    try {
      await _api.sendMessage(
        farm.id,
        advice: choice.startsWith('advice:') ? choice.substring(7) : null,
        text: text,
      );
      if (!mounted) return;
      setState(() => _events.insert(0, '${farm.name}: Felix sent a message'));
      _message('Sent to ${farm.name}');
    } on FieldwiseException catch (error) {
      _message(error.message);
    }
  }

  Widget _callbackPanel() => _panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Call back', style: Theme.of(context).textTheme.titleMedium),
        for (final callback in _callbacks)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.call_outlined),
            title: Text(callback.name),
            subtitle: Text(
              '${callback.phone} · asked ${_ago(callback.requestedAt)}',
            ),
            onTap: () => _call(callback.phone),
            trailing: TextButton(
              onPressed: () => _closeCallback(callback),
              child: const Text('Done'),
            ),
          ),
      ],
    ),
  );

  Widget _serverPanel() => _panel(
    child: ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        _live ? Icons.cloud_done_outlined : Icons.cloud_off_outlined,
      ),
      title: Text(_live ? 'Live from FieldWise' : 'Offline demo data'),
      subtitle: Text(
        !_live
            ? "Sign in with your officer access code to see farmers' answers."
            : _syncError ??
                  (_syncedAt == null
                      ? 'Connecting…'
                      : 'Signed in as ${_api.officerName ?? 'Felix'} · updated ${TimeOfDay.fromDateTime(_syncedAt!).format(context)}'),
      ),
      trailing: TextButton(
        onPressed: _live ? _signOut : _signIn,
        child: Text(_live ? 'Sign out' : 'Sign in'),
      ),
    ),
  );

  List<_Farm> get _ranked =>
      [..._farms]..sort((a, b) => b.score.compareTo(a.score));

  Future<void> _loadKasunguAssets() async {
    final mapJson = jsonDecode(
      await rootBundle.loadString('assets/demo/kasungu_map.json'),
    ) as Map<String, dynamic>;
    final features = mapJson['features'] as List<dynamic>;
    final roads = <Polyline>[];
    final rivers = <Polyline>[];
    for (final item in features) {
      final feature = item as Map<String, dynamic>;
      final points = (feature['points'] as List<dynamic>).map((value) {
        final pair = value as List<dynamic>;
        return LatLng((pair[0] as num).toDouble(), (pair[1] as num).toDouble());
      }).toList();
      final isRiver = feature['kind'] == 'waterway';
      final isPrimary = feature['value'] == 'primary';
      final line = Polyline(
        points: points,
        color: isRiver
            ? const Color(0xFF7CAEB1)
            : isPrimary
            ? const Color(0xFFD8C5A0)
            : const Color(0xFFF5F0E4),
        strokeWidth: isRiver
            ? 3
            : isPrimary
            ? 5
            : 2.5,
      );
      (isRiver ? rivers : roads).add(line);
    }
    final weatherJson = jsonDecode(
      await rootBundle.loadString('assets/demo/kasungu_weather.json'),
    ) as Map<String, dynamic>;
    final days = (weatherJson['daily'] as List<dynamic>)
        .take(3)
        .cast<Map<String, dynamic>>()
        .toList();
    final rain = days.fold<double>(
      0,
      (sum, day) => sum + (day['precipitation_sum'] as num).toDouble(),
    );
    final heat = days
        .map((day) => (day['temperature_2m_max'] as num).toDouble())
        .reduce(math.max);
    final date = DateTime.parse(days.first['date'] as String);
    if (!mounted) return;
    setState(() {
      _offlineRoads.addAll(roads);
      _offlineRivers.addAll(rivers);
      _forecastSource =
          'FieldWise Kasungu forecast · ${date.day}/${date.month}';
      for (final farm in _farms.where((farm) => !farm.weatherLive)) {
        farm.rain = rain;
        farm.heat = heat;
      }
    });
  }

  Future<void> _refreshData() async {
    // FieldWise's Kasungu snapshot is bundled for offline use. Fresh farm-level
    // forecasts and soil estimates replace it when the public APIs respond.
    // Signed in, FieldWise does this on the server instead.
    for (final farm in [..._farms]) {
      if (_live) return;
      try {
        final response = await _dio.get<Map<String, dynamic>>(
          'https://api.open-meteo.com/v1/forecast',
          queryParameters: {
            'latitude': farm.point.latitude,
            'longitude': farm.point.longitude,
            'daily': 'precipitation_sum,temperature_2m_max',
            'forecast_days': 3,
            'timezone': 'Africa/Blantyre',
          },
        );
        final daily = response.data?['daily'] as Map<String, dynamic>?;
        final rain = (daily?['precipitation_sum'] as List?)
            ?.take(3)
            .whereType<num>()
            .fold<double>(0, (a, b) => a + b.toDouble());
        final heat = (daily?['temperature_2m_max'] as List?)
            ?.take(3)
            .whereType<num>()
            .fold<double>(-100, (a, b) => math.max(a, b.toDouble()));
        if (rain != null && heat != null && mounted) {
          setState(() {
            final previousScore = farm.score;
            farm.rain = rain;
            farm.heat = heat;
            farm.weatherLive = true;
            if (previousScore < 55 && farm.score >= 55) {
              _alerts.insert(0, '${farm.name} moved into your priority queue.');
            }
          });
        }
      } catch (_) {
        // The local scenario remains usable without a connection.
      }
      try {
        final response = await _dio.get<Map<String, dynamic>>(
          'https://rest.isric.org/soilgrids/v2.0/properties/query',
          queryParameters: {
            'lon': farm.point.longitude,
            'lat': farm.point.latitude,
            'property': 'clay',
            'depth': '0-5cm',
            'value': 'mean',
          },
        );
        final layers =
            (response.data?['properties'] as Map?)?['layers'] as List?;
        final depths = (layers?.first as Map?)?['depths'] as List?;
        final values = (depths?.first as Map?)?['values'] as Map?;
        final raw = values?['mean'];
        if (raw is num && mounted) {
          setState(() {
            farm.clay = raw / 10; // SoilGrids clay is in g/kg.
            farm.soilLive = true;
          });
        }
      } catch (_) {
        // Without a soil estimate, soil-dependent risk rules stay disabled.
      }
    }
  }

  void _message(String value) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(value)));

  void _openAlerts() => showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        children: [
          Text('Notifications', style: Theme.of(ctx).textTheme.titleLarge),
          const SizedBox(height: 12),
          for (final alert in _alerts)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(LucideIcons.bell),
              title: Text(alert),
              subtitle: const Text('Fieldwise'),
            ),
        ],
      ),
    ),
  );

  void _openFarm(_Farm farm) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, refresh) => SafeArea(
          child: FractionallySizedBox(
            heightFactor: .83,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        farm.name,
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                    ),
                    TextButton(
                      onPressed: () =>
                          _changeDecision(farm, () => refresh(() {})),
                      child: const Text('Change'),
                    ),
                  ],
                ),
                Text(
                  [
                    farm.id,
                    if (farm.ward != null) '${farm.ward} ward',
                    farm.crop,
                    farm.status,
                  ].join(' · '),
                ),
                const SizedBox(height: 18),
                _detailLine('What to do', farm.action),
                _detailLine('Why', farm.why),
                _detailLine('How to check success', farm.success),
                if (farm.report != null)
                  _detailLine(
                    'Farmer check-in',
                    '${farm.report}: ${farm.answers}',
                  ),
                if (farm.override != null)
                  _detailLine('Felix changed the plan', farm.override!),
                if (farm.line?.answerLine != null)
                  _detailLine("Farmer's answers", farm.line!.answerLine!),
                if (farm.line?.notes.isNotEmpty ?? false)
                  _detailLine('Notes', farm.line!.notes.join('\n')),
                const SizedBox(height: 12),
                Text(
                  'Evidence',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (farm.live)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(LucideIcons.cloud),
                    title: Text(
                      (farm.line?.conditions.isNotEmpty ?? false)
                          ? farm.line!.conditions
                          : 'Not flagged by the forecast',
                    ),
                    subtitle: const Text(
                      'FieldWise forecast check · Open-Meteo and SoilGrids',
                    ),
                  ),
                if (!farm.live)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(LucideIcons.cloud),
                  title: Text(
                    '${farm.rain.toStringAsFixed(0)} mm rain · ${farm.heat.toStringAsFixed(0)}°C high',
                  ),
                  subtitle: Text(
                    farm.weatherLive
                        ? 'Open-Meteo · next 3 days · refreshed today'
                        : _forecastSource,
                  ),
                ),
                if (!farm.live && farm.soilLive)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(LucideIcons.layers),
                    title: Text(
                      '${farm.clay.toStringAsFixed(0)}% mapped clay · 0–5 cm',
                    ),
                    subtitle: const Text('SoilGrids mapped estimate'),
                  ),
                const Text(
                  'Forecasts and mapped soil are signals to check in the field, not a crop diagnosis.',
                ),
                if (farm.note != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text('Field note: ${farm.note}'),
                  ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () =>
                            _changeDecision(farm, () => refresh(() {})),
                        child: const Text('Change'),
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: FilledButton(
                        onPressed: () {
                          setState(() => farm.planned = true);
                          refresh(() {});
                          _message('${farm.name} added to your plan');
                        },
                        child: Text(farm.planned ? 'In plan' : 'Add to plan'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (farm.live)
                  Row(
                    children: [
                      Expanded(
                        child: TextButton.icon(
                          onPressed: () {
                            Navigator.pop(sheetContext);
                            _compose(farm);
                          },
                          icon: const Icon(Icons.sms_outlined),
                          label: const Text('Message farmer'),
                        ),
                      ),
                      if (farm.phone != null)
                        Expanded(
                          child: TextButton.icon(
                            onPressed: () => _call(farm.phone!),
                            icon: const Icon(Icons.call_outlined),
                            label: const Text('Call'),
                          ),
                        ),
                    ],
                  )
                else
                  TextButton.icon(
                    onPressed: () {
                      Navigator.pop(sheetContext);
                      _openCheckIn(farm);
                    },
                    icon: const Icon(Icons.dialpad),
                    label: const Text('Open farmer check-in'),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _detailLine(String title, String body) => Padding(
    padding: const EdgeInsets.only(bottom: 15),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: Theme.of(context).textTheme.labelLarge
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 3),
        Text(body),
      ],
    ),
  );

  void _changeDecision(_Farm farm, VoidCallback refresh) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Change recommendation',
                style: Theme.of(ctx).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              for (final option in const [
                'More urgent',
                'Call instead',
                'Already checked',
                'Different action',
              ])
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(option),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    Navigator.pop(ctx);
                    if (option == 'Different action') {
                      final text = await _askNote('What should Felix do?');
                      if (text == null || text.isEmpty) return;
                      setState(() {
                        farm.override = option;
                        farm.note = text;
                      });
                    } else {
                      setState(() {
                        farm.override = option;
                        if (option == 'Already checked') farm.completed = true;
                      });
                    }
                    _events.insert(
                      0,
                      '${farm.name}: Felix changed the plan to ${farm.override}',
                    );
                    refresh();
                    _message('Plan updated for ${farm.name}');
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<String?> _askNote(String title) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Short field note'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  Future<void> _openCheckIn(_Farm farm) async {
    final previousReportAt = farm.reportedAt;
    await Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (_) => _CheckInPage(
          farm: farm,
          onComplete: (concern, answers) {
            setState(() {
              farm.report = concern ? 'Concern reported' : 'Conditions normal';
              farm.answers = answers;
              farm.reportedAt = DateTime.now();
              _events.insert(
                0,
                '${farm.name}: farmer check-in received · ${farm.report}',
              );
              _alerts.insert(
                0,
                '${farm.name}: ${concern ? 'farmer reported a concern' : 'farmer check-in received'}.',
              );
            });
          },
        ),
      ),
    );
    if (!mounted || farm.reportedAt == previousReportAt) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            farm.concerningReport
                ? 'Fieldwise alert: ${farm.name} needs review'
                : '${farm.name}: check-in received',
          ),
          action: SnackBarAction(
            label: 'View',
            onPressed: () => _openFarm(farm),
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) => AlmanacScaffold(
    destination: NavDestination.values[_tab],
    onSelect: (destination) => setState(() => _tab = destination.index),
    onAssistantPressed: () => _message(_ranked.first.why),
    body: _tab == 1
        ? _farmsPage()
        : SafeArea(
            bottom: false,
            child: switch (_tab) {
              0 => _home(),
              2 => _planPage(),
              _ => _activityPage(),
            },
          ),
  );

  EdgeInsets get _pagePadding => const EdgeInsets.fromLTRB(
    AlmanacDimens.gutter,
    AlmanacDimens.sp4,
    AlmanacDimens.gutter,
    BottomNavIsland.bottomInset,
  );

  Widget _home() {
    final ranked = _ranked;
    final carouselFarms = ranked.skip(1).take(4).toList();
    final selected = carouselFarms.isEmpty
        ? ranked.first
        : carouselFarms[_farmIndex.clamp(0, carouselFarms.length - 1)];
    final visits = ranked
        .where(
          (farm) =>
              !farm.completed &&
              farm.override != 'Call instead' &&
              farm.score >= 55,
        )
        .take(3)
        .toList();
    return ListView(
      padding: const EdgeInsets.only(
        top: AlmanacDimens.sp4,
        bottom: BottomNavIsland.bottomInset,
      ),
      children: [
        _homeInset(
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Hello, ${_api.officerName ?? 'Felix'}',
                      style: Theme.of(context).textTheme.headlineLarge,
                    ),
                    Text(
                      greetingDate(DateTime.now()),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    Text(
                      _live ? 'Live from FieldWise' : 'Offline demo data',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Notifications',
                onPressed: _openAlerts,
                icon: Badge(
                  label: Text('${_alerts.length}'),
                  child: const Icon(LucideIcons.bell),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AlmanacDimens.sp5),
        _homeInset(_focusHero(ranked.first)),
        if (_callbacks.isNotEmpty) ...[
          const SizedBox(height: AlmanacDimens.sp5),
          _homeInset(_callbackPanel()),
        ],
        const SizedBox(height: AlmanacDimens.sp5),
        _homeInset(
          SectionHeader(
            title: 'Your farms',
            subtitle: 'Next farms to check',
            actionLabel: 'See all',
            onAction: _openFarmList,
          ),
        ),
        LayoutBuilder(
          builder: (context, constraints) {
            final pageWidth = constraints.maxWidth * .72;
            final mediaWidth =
                pageWidth -
                AlmanacDimens.sp2 * 2 -
                AlmanacDimens.rFrameInset * 2;
            final cardHeight =
                mediaWidth * 5 / 4 + AlmanacDimens.rFrameInset + 26;
            return SizedBox(
              height: cardHeight + 21,
              child: PageView.builder(
                controller: _carousel,
                clipBehavior: Clip.none,
                itemCount: carouselFarms.length,
                onPageChanged: (index) => setState(() => _farmIndex = index),
                itemBuilder: (context, index) => AnimatedBuilder(
                  animation: _carousel,
                  builder: (context, child) {
                    final page = _carousel.hasClients
                        ? _carousel.page ?? _farmIndex.toDouble()
                        : _farmIndex.toDouble();
                    return Opacity(
                      opacity: carouselOpacityFor(page, index),
                      child: Transform.scale(
                        scale: carouselScaleFor(page, index),
                        alignment: Alignment.bottomCenter,
                        child: child,
                      ),
                    );
                  },
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: SizedBox(
                      height: cardHeight,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AlmanacDimens.sp2,
                        ),
                        child: _hero(carouselFarms[index], index + 2),
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 10),
        _homeInset(
          Row(
            children: [
              Icon(
                LucideIcons.sprout,
                size: 18,
                color: _riskColor(selected.score),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${selected.status} · ${selected.action}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
              TextButton(
                onPressed: () => _openFarm(selected),
                child: const Text('Details'),
              ),
            ],
          ),
        ),
        const SizedBox(height: AlmanacDimens.sp5),
        _homeInset(
          SectionHeader(
            title: "Today's plan",
            subtitle: '${visits.length} suggested visits',
            actionLabel: 'Open plan',
            onAction: () => setState(() => _tab = 2),
          ),
        ),
        for (final farm in visits) ...[
          _homeInset(
            _panel(
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  backgroundColor: _riskColor(farm.score)
                      .withValues(alpha: .13),
                  child: Icon(
                    LucideIcons.mapPin,
                    color: _riskColor(farm.score),
                  ),
                ),
                title: Text(farm.name),
                subtitle: Text(farm.action),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _openFarm(farm),
              ),
            ),
          ),
          const SizedBox(height: 9),
        ],
        const SizedBox(height: AlmanacDimens.sp3),
        _homeInset(
          SectionHeader(
            title: 'Farm map',
            subtitle: 'Kasungu hotspots',
            actionLabel: 'Open map',
            onAction: () => setState(() => _tab = 1),
          ),
        ),
        _homeInset(
          GestureDetector(
            onTap: () => setState(() => _tab = 1),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AlmanacDimens.r2xl),
              child: SizedBox(
                height: 205,
                child: Stack(
                  children: [
                    IgnorePointer(child: _mapCanvas()),
                    const Positioned(
                      top: 12,
                      left: 12,
                      child: OfflineBadge(label: 'Offline map'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: AlmanacDimens.sp5),
        _homeInset(const SectionHeader(title: 'Field actions')),
        _homeInset(
          QuickActions(
            actions: [
              QuickAction(
                icon: LucideIcons.map,
                label: 'Farm map',
                onTap: () => setState(() => _tab = 1),
              ),
              QuickAction(
                icon: LucideIcons.route,
                label: 'Plan visits',
                onTap: () => setState(() => _tab = 2),
              ),
              QuickAction(
                icon: LucideIcons.notebookPen,
                label: 'Field record',
                onTap: () => setState(() => _tab = 3),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _homeInset(Widget child) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: AlmanacDimens.gutter),
    child: child,
  );

  Widget _focusHero(_Farm farm) => GestureDetector(
    onTap: () => _openFarm(farm),
    child: ClipRRect(
      borderRadius: BorderRadius.circular(AlmanacDimens.r2xl),
      child: AspectRatio(
        aspectRatio: 16 / 11,
        child: Stack(
          fit: StackFit.expand,
          children: [
            CropImagery(
              scene: CropScene.farm,
              seed: farm.name,
              demoPhotography: true,
            ),
            const ImageryScrim(),
            Positioned(
              top: AlmanacDimens.sp4,
              left: AlmanacDimens.sp4,
              right: AlmanacDimens.sp4,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  ScrimBadge(icon: LucideIcons.sprout, text: farm.status),
                  IconOnlyButton(
                    icon: LucideIcons.map,
                    semanticLabel: 'Open farm map',
                    onImagery: true,
                    onPressed: () => setState(() {
                      _selectedMapFarmId = farm.id;
                      _tab = 1;
                    }),
                  ),
                ],
              ),
            ),
            Positioned(
              left: AlmanacDimens.sp5,
              right: AlmanacDimens.sp5,
              bottom: AlmanacDimens.sp5,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    farm.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.headlineSmall
                        ?.copyWith(color: Colors.white),
                  ),
                  Text(
                    'Kasungu · ${farm.crop}',
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: const Color(0xFFE4E1D8)),
                  ),
                  const SizedBox(height: AlmanacDimens.sp2),
                  Text(
                    farm.action,
                    style: Theme.of(context).textTheme.titleSmall
                        ?.copyWith(color: Colors.white),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _hero(_Farm farm, int rank) {
    final colors = context.semantic;
    final media = ClipRRect(
      borderRadius: BorderRadius.circular(26),
      child: AspectRatio(
        aspectRatio: 4 / 5,
        child: Stack(
          fit: StackFit.expand,
          children: [
            CropImagery(
              scene: CropScene.farm,
              seed: farm.name,
              demoPhotography: true,
            ),
            const ImageryScrim(),
            Positioned(
              top: AlmanacDimens.sp3,
              left: AlmanacDimens.sp3,
              child: ScrimBadge(icon: LucideIcons.leaf, text: farm.crop),
            ),
            Positioned(
              left: AlmanacDimens.sp4,
              right: AlmanacDimens.sp4,
              bottom: AlmanacDimens.sp5,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Priority $rank',
                    style: Theme.of(context).textTheme.labelSmall
                        ?.copyWith(color: const Color(0xFFE4E1D8)),
                  ),
                  Text(
                    farm.status,
                    style: Theme.of(context).textTheme.headlineSmall
                        ?.copyWith(color: Colors.white),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    return Semantics(
      button: true,
      label: 'Open ${farm.name}, priority $rank, ${farm.status}',
      child: GestureDetector(
        onTap: () => _openFarm(farm),
        behavior: HitTestBehavior.opaque,
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.bottomCenter,
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(
                AlmanacDimens.rFrameInset,
                AlmanacDimens.rFrameInset,
                AlmanacDimens.rFrameInset,
                26,
              ),
              decoration: BoxDecoration(
                color: colors.surface,
                borderRadius: BorderRadius.circular(AlmanacDimens.r2xl),
                border: Border.all(color: colors.outlineVariant),
                boxShadow: almanacElevation(context),
              ),
              child: media,
            ),
            Positioned(
              bottom: -21,
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: 42,
                  maxWidth: MediaQuery.sizeOf(context).width * .55,
                ),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AlmanacDimens.sp4,
                  ),
                  decoration: BoxDecoration(
                    color: colors.surface,
                    borderRadius: BorderRadius.circular(AlmanacDimens.rPill),
                    border: Border.all(color: colors.outlineVariant),
                    boxShadow: almanacElevation(context),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 9,
                        height: 9,
                        decoration: BoxDecoration(
                          color: farm.score >= 75
                              ? colors.statusActionRequired
                              : farm.score >= 55
                              ? colors.statusNeedsAttention
                              : colors.statusOnTrack,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: AlmanacDimens.sp2),
                      Flexible(
                        child: Text(
                          farm.name,
                          style: Theme.of(context).textTheme.titleSmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _mapCanvas({ValueChanged<_Farm>? onSelect}) => FlutterMap(
    options: MapOptions(
      backgroundColor: const Color(0xFFE5E9DB),
      initialCenter: const LatLng(-13.037, 33.490),
      initialZoom: 14.7,
      interactionOptions: const InteractionOptions(
        flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
      ),
    ),
    children: [
      PolylineLayer(polylines: _offlineRivers),
      PolylineLayer(polylines: _offlineRoads),
      CircleLayer(
        circles: [
          for (final farm in _farms.where((farm) => farm.score >= 55))
            CircleMarker(
              point: farm.point,
              radius: 180,
              useRadiusInMeter: true,
              color: _riskColor(farm.score).withValues(alpha: .13),
              borderColor: _riskColor(farm.score).withValues(alpha: .4),
              borderStrokeWidth: 1,
            ),
        ],
      ),
      MarkerLayer(
        markers: [
          for (final farm in _farms)
            Marker(
              point: farm.point,
              width: 48,
              height: 48,
              child: IconButton(
                tooltip: '${farm.name} · ${farm.status}',
                onPressed: () => onSelect?.call(farm),
                icon: Icon(
                  Icons.location_on,
                  color: _riskColor(farm.score),
                  size: 35,
                ),
              ),
            ),
        ],
      ),
    ],
  );

  Widget _farmsPage() {
    final ranked = _ranked;
    final selected = ranked.firstWhere(
      (farm) => farm.id == _selectedMapFarmId,
      orElse: () => ranked.first,
    );
    return Stack(
      fit: StackFit.expand,
      children: [
        _mapCanvas(
          onSelect: (farm) => setState(() => _selectedMapFarmId = farm.id),
        ),
        SafeArea(
          bottom: false,
          child: Align(
            alignment: Alignment.topCenter,
            child: Padding(
              padding: const EdgeInsets.all(AlmanacDimens.gutter),
              child: Row(
                children: [
                  Expanded(
                    child: _panel(
                      child: Row(
                        children: [
                          const Icon(LucideIcons.mapPin, size: 20),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'Kasungu',
                                style: Theme.of(context).textTheme.titleSmall,
                              ),
                              Text(
                                '${_farms.length} farms · priority hotspots',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  IconButton.filledTonal(
                    tooltip: 'Find a farm',
                    onPressed: _openFarmList,
                    icon: const Icon(LucideIcons.list),
                  ),
                ],
              ),
            ),
          ),
        ),
        Positioned(
          left: AlmanacDimens.gutter,
          right: AlmanacDimens.gutter,
          bottom: BottomNavIsland.bottomInset + AlmanacDimens.sp3,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: const OfflineBadge(label: 'Offline map'),
              ),
              const SizedBox(height: 10),
              _panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            selected.name,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        Text(
                          selected.status,
                          style: Theme.of(context).textTheme.labelMedium
                              ?.copyWith(color: _riskColor(selected.score)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(
                      '${selected.crop} · ${selected.action}',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 5),
                    Text(
                      selected.why,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: () => _openFarm(selected),
                        child: const Text('View action'),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '© OpenStreetMap contributors · saved Kasungu map',
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _openFarmList() => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => StatefulBuilder(
      builder: (context, refreshSheet) => FractionallySizedBox(
        heightFactor: .88,
        child: _farmListPage(refreshSheet),
      ),
    ),
  );

  Widget _farmListPage(StateSetter refreshSheet) {
    final farms = _ranked.where((farm) {
      final matchText = '${farm.name} ${farm.id} ${farm.crop}'
          .toLowerCase()
          .contains(_search.toLowerCase());
      final matchFilter =
          _filter == 'All' ||
          (_filter == 'Priority' && farm.score >= 55) ||
          (_filter == 'Reports' && farm.report != null);
      return matchText && matchFilter;
    }).toList();
    return ListView(
      padding: _pagePadding,
      children: [
        _eyebrow('FARMS'),
        const SizedBox(height: 6),
        Text(
          'Your farms',
          style: Theme.of(context).textTheme.headlineMedium
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(
          '${_farms.length} farms · tap a farm for details',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 17),
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Nearby hotspots',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 9),
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: SizedBox(
                  height: 235,
                  child: Stack(
                    children: [
                      FlutterMap(
                        options: MapOptions(
                          backgroundColor: const Color(0xFFE5E9DB),
                          initialCenter: const LatLng(-13.037, 33.490),
                          initialZoom: 14.7,
                          interactionOptions: const InteractionOptions(
                            flags:
                                InteractiveFlag.all & ~InteractiveFlag.rotate,
                          ),
                        ),
                        children: [
                          PolylineLayer(polylines: _offlineRivers),
                          PolylineLayer(polylines: _offlineRoads),
                          CircleLayer(
                            circles: [
                              for (final farm in _farms.where(
                                (f) => f.score >= 55,
                              ))
                                CircleMarker(
                                  point: farm.point,
                                  radius: 180,
                                  useRadiusInMeter: true,
                                  color: _riskColor(farm.score)
                                      .withValues(alpha: .13),
                                  borderColor: _riskColor(farm.score)
                                      .withValues(alpha: .4),
                                  borderStrokeWidth: 1,
                                ),
                            ],
                          ),
                          MarkerLayer(
                            markers: [
                              for (final farm in _farms)
                                Marker(
                                  point: farm.point,
                                  width: 48,
                                  height: 48,
                                  child: IconButton(
                                    tooltip: '${farm.name} · ${farm.status}',
                                    onPressed: () => _openFarm(farm),
                                    icon: Icon(
                                      Icons.location_on,
                                      color: _riskColor(farm.score),
                                      size: 35,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                      const Positioned(
                        top: AlmanacDimens.sp3,
                        left: AlmanacDimens.sp3,
                        child: OfflineBadge(label: 'Offline map'),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 7),
              InkWell(
                onTap: () => launchUrl(
                  Uri.parse('https://www.openstreetmap.org/copyright'),
                ),
                child: Text(
                  'Kasungu offline map · © OpenStreetMap contributors · coloured circles show priority farms',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          onChanged: (value) {
            setState(() => _search = value);
            refreshSheet(() {});
          },
          decoration: InputDecoration(
            hintText: 'Find a farm',
            prefixIcon: const Icon(Icons.search),
            filled: true,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(15),
              borderSide: BorderSide.none,
            ),
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 7,
          children: [
            for (final value in const ['All', 'Priority', 'Reports'])
              ChoiceChip(
                label: Text(value),
                selected: _filter == value,
                onSelected: (_) {
                  setState(() => _filter = value);
                  refreshSheet(() {});
                },
              ),
          ],
        ),
        const SizedBox(height: 15),
        for (final farm in farms) ...[
          _panel(
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(
                backgroundColor: _riskColor(farm.score).withValues(alpha: .13),
                child: Icon(LucideIcons.sprout, color: _riskColor(farm.score)),
              ),
              title: Text(farm.name),
              subtitle: Text('${farm.crop} · ${farm.status}'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _openFarm(farm),
            ),
          ),
          const SizedBox(height: 9),
        ],
      ],
    );
  }

  Widget _planPage() {
    final pending = _ranked
        .where(
          (f) =>
              !f.completed &&
              f.override != 'Call instead' &&
              (f.score >= 55 || f.planned),
        )
        .toList();
    final calls = _ranked
        .where((f) => !f.completed && f.override == 'Call instead')
        .toList();
    return ListView(
      padding: _pagePadding,
      children: [
        _eyebrow('FIELD PLAN'),
        const SizedBox(height: 6),
        Text(
          'Plan your day',
          style: Theme.of(context).textTheme.headlineMedium
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(
          '${math.min(3, pending.length)} suggested visits · ${calls.length} call${calls.length == 1 ? '' : 's'} · ${math.max(0, pending.length - 3)} next in queue',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 17),
        if (calls.isNotEmpty) ...[
          const SectionHeader(title: 'Calls'),
          for (final farm in calls) ...[
            _panel(
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(LucideIcons.phone),
                title: Text(farm.name),
                subtitle: const Text('Call farmer'),
                trailing: TextButton(
                  onPressed: () async {
                    final note = await _askNote(
                      'What did you learn on the call?',
                    );
                    if (note == null || note.isEmpty) return;
                    setState(() {
                      farm.completed = true;
                      farm.note = note;
                      _events.insert(0, '${farm.name}: call recorded');
                    });
                  },
                  child: const Text('Record'),
                ),
                onTap: () => _openFarm(farm),
              ),
            ),
            const SizedBox(height: 9),
          ],
          const SectionHeader(title: 'Visits'),
        ],
        for (var i = 0; i < pending.length; i++) ...[
          if (i == 3) const SectionHeader(title: 'Next in queue'),
          _panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(child: Text('${i + 1}')),
                  title: Text(pending[i].name),
                  subtitle: Text(pending[i].action),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _openFarm(pending[i]),
                ),
                if (i < 3)
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => _openFarm(pending[i]),
                          child: const Text('Review'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: FilledButton(
                          onPressed: () async {
                            final note = await _askNote(
                              'What did you observe?',
                            );
                            if (note == null || note.isEmpty) return;
                            setState(() {
                              pending[i].completed = true;
                              pending[i].note = note;
                              _events.insert(
                                0,
                                '${pending[i].name}: visit recorded',
                              );
                            });
                          },
                          child: const Text('Record visit'),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
          const SizedBox(height: 9),
        ],
        if (pending.isEmpty)
          _panel(child: const Text('No priority visits are waiting.')),
      ],
    );
  }

  Widget _activityPage() => ListView(
    padding: _pagePadding,
    children: [
      _eyebrow('FIELD RECORD'),
      const SizedBox(height: 6),
      Text(
        'Your activity',
        style: Theme.of(context).textTheme.headlineMedium
            ?.copyWith(fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: 4),
      Text(
        'Farmer answers and field decisions',
        style: Theme.of(context).textTheme.bodyMedium,
      ),
      const SizedBox(height: 17),
      _serverPanel(),
      const SizedBox(height: 17),
      // Signed in, farmers answer on their own phones (USSD or WhatsApp);
      // the in-app check-in is for the offline demo.
      if (!_live) ...[
        _panel(
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.dialpad),
            title: const Text('Farmer check-in'),
            subtitle: const Text('Open a check-in for a farm'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _chooseCheckInFarm(),
          ),
        ),
        const SizedBox(height: 17),
      ],
      for (final farm in _ranked.where((item) => item.report != null)) ...[
        _panel(
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.dialpad),
            title: Text(farm.name),
            subtitle: Text(farm.report!),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _openFarm(farm),
          ),
        ),
        const SizedBox(height: 9),
      ],
      if (_events.isEmpty)
        _panel(
          child: const Text(
            'New check-ins and field decisions will appear here.',
          ),
        ),
      for (final event in _events) ...[
        _panel(
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(LucideIcons.notebookPen),
            title: Text(event),
          ),
        ),
        const SizedBox(height: 9),
      ],
    ],
  );

  void _chooseCheckInFarm() => showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: [
          Padding(
            padding: const EdgeInsets.all(20),
            child: Text(
              'Choose a farm',
              style: Theme.of(ctx).textTheme.titleLarge,
            ),
          ),
          for (final farm in _ranked)
            ListTile(
              title: Text(farm.name),
              subtitle: Text(
                farm.wetFlag
                    ? 'Rain and drainage check'
                    : farm.dryFlag
                    ? 'Heat and water check'
                    : 'Crop check',
              ),
              onTap: () {
                Navigator.pop(ctx);
                _openCheckIn(farm);
              },
            ),
        ],
      ),
    ),
  );

  Widget _panel({required Widget child}) => AlmanacCard(
    padding: const EdgeInsets.all(AlmanacDimens.sp4),
    child: Material(color: Colors.transparent, child: child),
  );

  Widget _eyebrow(String value) => Text(
    value,
    style: Theme.of(context).textTheme.labelSmall?.copyWith(
      color: Theme.of(context).colorScheme.primary,
      letterSpacing: 1.5,
      fontWeight: FontWeight.w800,
    ),
  );
}

Color _riskColor(int score) => score >= 75
    ? const Color(0xFFB93831)
    : score >= 55
    ? const Color(0xFFAD6A00)
    : const Color(0xFF29835E);

class _CheckInPage extends StatefulWidget {
  const _CheckInPage({required this.farm, required this.onComplete});
  final _Farm farm;
  final void Function(bool concern, String answers) onComplete;

  @override
  State<_CheckInPage> createState() => _CheckInPageState();
}

class _CheckInPageState extends State<_CheckInPage> {
  int _step = 0;
  bool? _concern;
  final _answers = <String>[];
  final _entry = TextEditingController();
  String? _inputError;

  @override
  void dispose() {
    _entry.dispose();
    super.dispose();
  }

  bool get _wet => widget.farm.wetFlag;
  String get _firstQuestion => _wet
      ? 'Is there standing water in your field?'
      : widget.farm.dryFlag
      ? 'Are plants wilting during the day?'
      : 'Have you noticed a new crop problem?';
  String get _secondQuestion => _wet
      ? 'Is it in one area or several areas?'
      : 'Are several parts of the field affected?';
  String get _question => _step == 0
      ? _firstQuestion
      : _step == 1
      ? _secondQuestion
      : 'How long have you noticed this?';
  List<String> get _options => _step == 0
      ? const ['Yes', 'No', 'Not sure']
      : _step == 1
      ? const ['One area', 'Several areas', 'Not sure']
      : const ['Today', 'More than one day', 'Not sure'];

  void _submit() {
    final choice = int.tryParse(_entry.text.trim());
    if (choice == null || choice < 1 || choice > 3) {
      setState(() => _inputError = 'Enter 1, 2 or 3');
      return;
    }
    _entry.clear();
    setState(() => _inputError = null);
    _answer(choice);
  }

  void _answer(int choice) {
    if (_step == 0) {
      _answers.add('$_firstQuestion ${_options[choice - 1]}');
      if (choice == 2) {
        _finish(false);
      } else {
        _concern = true;
        setState(() => _step = 1);
      }
    } else if (_step == 1) {
      _answers.add('$_secondQuestion ${_options[choice - 1]}');
      if (choice == 1) {
        _finish(true);
      } else {
        setState(() => _step = 2);
      }
    } else {
      _answers.add('$_question ${_options[choice - 1]}');
      _finish(true);
    }
  }

  void _finish(bool concern) {
    widget.onComplete(concern, _answers.join(' · '));
    setState(() {
      _concern = concern;
      _step = 3;
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFF26342E),
    appBar: AppBar(title: const Text('Phone')),
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            elevation: 8,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(22, 20, 22, 12),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('USSD', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(
                    '*123# · ${widget.farm.name}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const Divider(height: 25),
                  if (_step < 3) ...[
                    Text(_question),
                    const SizedBox(height: 12),
                    for (var i = 0; i < _options.length; i++)
                      InkWell(
                        onTap: () {
                          _entry.text = '${i + 1}';
                          _submit();
                        },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Text('${i + 1}. ${_options[i]}'),
                        ),
                      ),
                    TextField(
                      controller: _entry,
                      keyboardType: TextInputType.number,
                      onSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        hintText: 'Reply with a number',
                        errorText: _inputError,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('Cancel'),
                        ),
                        TextButton(
                          onPressed: _submit,
                          child: const Text('Send'),
                        ),
                      ],
                    ),
                  ] else ...[
                    Text(
                      'Response sent to field officer Felix.',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 10),
                    Text(
                      _concern == true
                          ? 'Please contact Felix today about the condition you reported.'
                          : 'Conditions look normal for now. Contact Felix if anything changes.',
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('OK'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
