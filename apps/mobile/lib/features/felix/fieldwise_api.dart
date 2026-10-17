import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the FieldWise logic layer runs (apps/logic). For a local server, run
/// with `--dart-define=FIELDWISE_URL=http://10.0.2.2:8789` (Android
/// emulator) or `http://localhost:8789` (iOS simulator).
const fieldwiseUrl = String.fromEnvironment(
  'FIELDWISE_URL',
  defaultValue: 'https://fieldwise-logic.takudzwamhizha132.workers.dev',
);

/// A farmer on Felix's list, from `GET /farmers`.
class FieldwiseFarmer {
  const FieldwiseFarmer({
    required this.id,
    required this.name,
    required this.farmName,
    required this.phone,
    required this.channel,
    required this.latitude,
    required this.longitude,
    required this.ward,
  });

  factory FieldwiseFarmer.fromJson(Map<String, dynamic> json) =>
      FieldwiseFarmer(
        id: json['id'] as String,
        name: json['name'] as String,
        farmName: json['farm_name'] as String?,
        phone: json['phone'] as String,
        channel: json['channel'] as String,
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        ward: json['ward'] as String?,
      );

  final String id;
  final String name;
  final String? farmName;
  final String phone;

  /// `ussd` (keypad phone: SMS and USSD), `whatsapp`, or `sim` (demo chat).
  final String channel;
  final double latitude;
  final double longitude;

  /// The ward the farmer gave (the first question they answer); null until then.
  final String? ward;
}

/// One farm's line on Felix's priority list, from `GET /felix/priority`.
class FieldwiseLine {
  const FieldwiseLine({
    required this.flagId,
    required this.farmerId,
    required this.crop,
    required this.flagged,
    required this.rank,
    required this.label,
    required this.state,
    required this.answered,
    required this.provisional,
    required this.source,
    required this.outcome,
    required this.urgent,
    required this.answersSay,
    required this.answerLine,
    required this.notes,
    required this.conditions,
    required this.also,
  });

  factory FieldwiseLine.fromJson(Map<String, dynamic> json) {
    final report = json['report'] as Map<String, dynamic>?;
    return FieldwiseLine(
      flagId: json['flag_id'] as String,
      farmerId: (json['farmer'] as Map<String, dynamic>)['id'] as String,
      crop: json['crop'] as String,
      flagged: json['flagged'] as String,
      rank: json['rank'] as String,
      label: json['label'] as String,
      state: json['state'] as String,
      answered: (json['answered'] as num).toInt(),
      provisional: json['provisional'] as bool? ?? false,
      source: json['source'] as String,
      outcome: report?['outcome'] as String?,
      urgent: report?['urgent'] as bool? ?? false,
      answersSay: [
        for (final item in report?['answersSay'] as List? ?? const [])
          item as String,
      ],
      answerLine: report?['answerLine'] as String?,
      notes: [
        for (final item in report?['notes'] as List? ?? const []) item as String,
      ],
      conditions: json['conditions'] as String? ?? '',
      also: (json['also'] as List? ?? const []).length,
    );
  }

  final String flagId;
  final String farmerId;
  final String crop;

  /// The disease the forecast flagged, e.g. "late blight".
  final String flagged;

  /// go_now, this_week, no_response, recheck, waiting or none.
  final String rank;
  final String label;

  /// answered, answering, waiting or no_response.
  final String state;
  final int answered;
  final bool provisional;

  /// forecast, scenario, manual, or farmer (the farmer reported it by USSD).
  final String source;
  final String? outcome;
  final bool urgent;
  final List<String> answersSay;
  final String? answerLine;
  final List<String> notes;
  final String conditions;

  /// How many other flags the farm has in the window.
  final int also;
}

/// A farmer who asked Felix to call, from the USSD menu.
class FieldwiseCallback {
  const FieldwiseCallback({
    required this.id,
    required this.farmerId,
    required this.name,
    required this.phone,
    required this.requestedAt,
  });

  factory FieldwiseCallback.fromJson(Map<String, dynamic> json) {
    final farmer = json['farmer'] as Map<String, dynamic>;
    return FieldwiseCallback(
      id: json['id'] as String,
      farmerId: farmer['id'] as String,
      name: farmer['name'] as String,
      phone: farmer['phone'] as String,
      requestedAt: DateTime.parse(json['requested_at'] as String),
    );
  }

  final String id;
  final String farmerId;
  final String name;
  final String phone;
  final DateTime requestedAt;
}

/// A ready-made reply Felix can send.
class FieldwiseAdvice {
  const FieldwiseAdvice({
    required this.id,
    required this.label,
    required this.english,
  });

  factory FieldwiseAdvice.fromJson(Map<String, dynamic> json) =>
      FieldwiseAdvice(
        id: json['id'] as String,
        label: json['label'] as String,
        english: (json['text'] as Map<String, dynamic>)['en'] as String,
      );

  final String id;
  final String label;
  final String english;
}

class FieldwiseSnapshot {
  const FieldwiseSnapshot({
    required this.farmers,
    required this.lines,
    required this.callbacks,
  });

  final List<FieldwiseFarmer> farmers;
  final List<FieldwiseLine> lines;
  final List<FieldwiseCallback> callbacks;
}

class FieldwiseException implements Exception {
  const FieldwiseException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Felix's connection to the logic layer, signed in with his officer access
/// code (`fw_...`, made by the admin with `POST /officers/:id/token`). The
/// code is kept in the device's secure storage.
class FieldwiseApi {
  FieldwiseApi({Dio? dio, FlutterSecureStorage? storage, String? baseUrl})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              connectTimeout: const Duration(seconds: 8),
              receiveTimeout: const Duration(seconds: 8),
            ),
          ),
      _storage = storage ?? const FlutterSecureStorage(),
      _baseUrl = baseUrl ?? fieldwiseUrl;

  static const _tokenKey = 'fieldwise.officer_token';
  static const _nameKey = 'fieldwise.officer_name';

  final Dio _dio;
  final FlutterSecureStorage _storage;
  final String _baseUrl;
  String? _token;
  String? officerName;

  bool get signedIn => _token != null;

  /// Picks up a code saved on an earlier run. Never throws.
  Future<void> restore() async {
    try {
      _token = await _storage.read(key: _tokenKey);
      officerName = await _storage.read(key: _nameKey);
    } catch (_) {
      // No secure storage (a widget test, say): stay signed out.
    }
  }

  /// Checks the code with the server and keeps it. Returns the officer's name.
  Future<String> signIn(String code) async {
    final me = await _send('GET', '/me', token: code.trim());
    if (me['role'] != 'officer') {
      throw const FieldwiseException('That is not an officer access code.');
    }
    final name =
        (me['officer'] as Map<String, dynamic>)['name'] as String? ?? 'Felix';
    _token = code.trim();
    officerName = name;
    try {
      await _storage.write(key: _tokenKey, value: _token);
      await _storage.write(key: _nameKey, value: name);
    } catch (_) {
      // Signed in for this run only.
    }
    return name;
  }

  Future<void> signOut() async {
    _token = null;
    officerName = null;
    try {
      await _storage.delete(key: _tokenKey);
      await _storage.delete(key: _nameKey);
    } catch (_) {}
  }

  /// Felix's farmers, his priority list for the last 14 days, and call-backs.
  Future<FieldwiseSnapshot> snapshot() async {
    final farmers = await _send('GET', '/farmers');
    final priority = await _send('GET', '/felix/priority?days=14');
    return FieldwiseSnapshot(
      farmers: [
        for (final item in farmers['farmers'] as List)
          FieldwiseFarmer.fromJson(item as Map<String, dynamic>),
      ],
      lines: [
        for (final item in priority['farms'] as List)
          FieldwiseLine.fromJson(item as Map<String, dynamic>),
      ],
      callbacks: [
        for (final item in priority['callbacks'] as List? ?? const [])
          FieldwiseCallback.fromJson(item as Map<String, dynamic>),
      ],
    );
  }

  Future<List<FieldwiseAdvice>> advice() async {
    final data = await _send('GET', '/felix/advice');
    return [
      for (final item in data['advice'] as List)
        FieldwiseAdvice.fromJson(item as Map<String, dynamic>),
    ];
  }

  /// Sends a ready-made reply (`advice`) or Felix's own `text` to a farmer,
  /// by SMS or WhatsApp. Returns the message as sent.
  Future<String> sendMessage(
    String farmerId, {
    String? advice,
    String? text,
  }) async {
    final data = await _send(
      'POST',
      '/farmers/${Uri.encodeComponent(farmerId)}/messages',
      body: advice != null ? {'advice': advice} : {'text': text},
    );
    return data['sent'] as String;
  }

  Future<void> closeCallback(String id) async {
    await _send('POST', '/felix/callbacks/${Uri.encodeComponent(id)}/done',
        body: const <String, Object>{});
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Object? body,
    String? token,
  }) async {
    final code = token ?? _token;
    if (code == null) throw const FieldwiseException('Not signed in.');
    try {
      final response = await _dio.request<Map<String, dynamic>>(
        '$_baseUrl$path',
        data: body,
        options: Options(
          method: method,
          headers: {'Authorization': 'Bearer $code'},
          contentType: body == null ? null : Headers.jsonContentType,
        ),
      );
      return response.data ?? const {};
    } on DioException catch (error) {
      final data = error.response?.data;
      final message = data is Map && data['error'] is String
          ? data['error'] as String
          : error.response == null
          ? 'No connection to FieldWise.'
          : 'FieldWise answered ${error.response!.statusCode}.';
      throw FieldwiseException(message);
    }
  }
}
