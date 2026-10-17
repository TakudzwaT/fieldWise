/// Leaf-disease risk from the 7-day forecast, and the maize USSD check-in that
/// confirms it with the farmer.
library;

class DayWeather {
  const DayWeather({
    required this.rainMm,
    required this.humidHours,
    required this.meanTempC,
  });

  final double rainMm;

  /// Hours in the day with relative humidity above 90 %.
  final int humidHours;
  final double meanTempC;
}

/// One point a day each for long humid spells, rain, and the 18–27 °C band in
/// which maize leaf blights spread fastest. A week scores 0–21.
int leafDiseaseScore(List<DayWeather> week) => week.fold(
  0,
  (total, day) =>
      total +
      (day.humidHours >= 6 ? 1 : 0) +
      (day.rainMm > 0 ? 1 : 0) +
      (day.meanTempC >= 18 && day.meanTempC <= 27 ? 1 : 0),
);

enum RiskLevel {
  low('Low'),
  medium('Medium'),
  high('High');

  const RiskLevel(this.label);
  final String label;
}

RiskLevel riskLevelFor(int score) => score >= 13
    ? RiskLevel.high
    : score >= 8
    ? RiskLevel.medium
    : RiskLevel.low;

/// What the farmer's answers mean for Felix's plan. [score] orders the plan;
/// higher goes first.
enum CheckOutcome {
  confirmedUrgent(100, 'Visit today'),
  wrongFlag(100, 'Visit today'),
  confirmed(80, 'Visit this week'),
  otherCrop(65, 'Call today'),
  earlySigns(56, 'Re-check'),
  clear(10, 'Clear');

  const CheckOutcome(this.score, this.status);
  final int score;
  final String status;

  bool get isUrgent => this == confirmedUrgent || this == wrongFlag;

  /// Found before the disease reached the leaves above the cob.
  bool get isCaughtEarly => this == confirmed || this == earlySigns;
}

/// Four main questions, each followed by a yes or a no follow-up. The farmer
/// never sees a disease name; [finding] is for Felix only.
class MaizeCheck {
  static const _screens = [
    (
      'Do the lower leaves of your maize have long marks running along them?',
      'Are the marks longer than your finger?',
      'Are the lowest leaves yellowing from the tip inwards?',
    ),
    (
      'Are the marks rectangles with straight sides?',
      'Are they grey or tan in the middle?',
      'Are they long cigar shapes with pointed ends?',
    ),
    (
      'Is it worse now than three days ago?',
      'Has it reached the leaves above the cob?',
      'Did the first marks show up within a week of the last heavy rain?',
    ),
    (
      'Are there yellow or pale stripes running the full length of the leaves, on stunted plants?',
      'Are the stripes on the newest leaves at the top?',
      'Are the plants a normal height for this stage?',
    ),
  ];

  final _answers = <bool>[];
  final transcript = <String>[];

  bool get isDone => _answers.length == _screens.length * 2;

  String get question {
    final screen = _screens[_answers.length ~/ 2];
    if (_answers.length.isEven) return screen.$1;
    return _answers.last ? screen.$2 : screen.$3;
  }

  void answer(bool yes) {
    transcript.add('$question ${yes ? 'Yes' : 'No'}');
    _answers.add(yes);
  }

  bool get _marks => _answers[0];
  bool get _tipYellowing => !_marks && _answers[1];
  bool get _rectangles => _answers[2];
  bool get _shapeMatched => _marks && _answers[3];
  bool get _aboveCob => _answers[4] && _answers[5];
  bool get _stripes => _answers[6];
  bool get _stunted => !_stripes && !_answers[7];

  CheckOutcome get outcome {
    if (_stripes) return CheckOutcome.wrongFlag;
    if (_shapeMatched) {
      return _aboveCob ? CheckOutcome.confirmedUrgent : CheckOutcome.confirmed;
    }
    if (_marks || _tipYellowing || _stunted) return CheckOutcome.earlySigns;
    return CheckOutcome.clear;
  }

  String get finding => switch (outcome) {
    CheckOutcome.wrongFlag => 'maize streak virus',
    CheckOutcome.confirmed || CheckOutcome.confirmedUrgent =>
      _rectangles ? 'grey leaf spot' : 'northern leaf blight',
    CheckOutcome.earlySigns => 'early signs, not yet identified',
    _ => 'nothing found',
  };
}
