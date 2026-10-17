import 'package:almanac/features/felix/maize_check.dart';
import 'package:flutter_test/flutter_test.dart';

const _wetMild = DayWeather(rainMm: 6, humidHours: 8, meanTempC: 22);
const _dryHot = DayWeather(rainMm: 0, humidHours: 2, meanTempC: 29);

/// Answers in screen order: Q1, its follow-up, Q2, follow-up, Q3, follow-up,
/// Q4, follow-up.
MaizeCheck _run(List<bool> answers) {
  final check = MaizeCheck();
  for (final yes in answers) {
    check.answer(yes);
  }
  return check;
}

void main() {
  group('leafDiseaseScore', () {
    test('adds one point each for humid hours, rain and a mild mean', () {
      expect(leafDiseaseScore(List.filled(7, _wetMild)), 21);
      expect(leafDiseaseScore(List.filled(7, _dryHot)), 0);
      expect(
        leafDiseaseScore([...List.filled(3, _wetMild), ...List.filled(4, _dryHot)]),
        9,
      );
    });

    test('counts six humid hours and 18 and 27 degrees, but not just past them', () {
      expect(
        leafDiseaseScore(const [
          DayWeather(rainMm: 0, humidHours: 6, meanTempC: 18),
          DayWeather(rainMm: 0, humidHours: 5, meanTempC: 27),
          DayWeather(rainMm: 0, humidHours: 0, meanTempC: 17.9),
          DayWeather(rainMm: 0, humidHours: 0, meanTempC: 27.1),
          DayWeather(rainMm: 0.1, humidHours: 0, meanTempC: 30),
        ]),
        4,
      );
    });
  });

  group('riskLevelFor', () {
    test('splits 0-7 low, 8-12 medium, 13-21 high', () {
      expect(riskLevelFor(0), RiskLevel.low);
      expect(riskLevelFor(7), RiskLevel.low);
      expect(riskLevelFor(8), RiskLevel.medium);
      expect(riskLevelFor(12), RiskLevel.medium);
      expect(riskLevelFor(13), RiskLevel.high);
      expect(riskLevelFor(21), RiskLevel.high);
    });
  });

  group('MaizeCheck screens', () {
    test('asks a follow-up that depends on the yes or no answer', () {
      final yes = MaizeCheck()..answer(true);
      final no = MaizeCheck()..answer(false);
      expect(
        MaizeCheck().question,
        'Do the lower leaves of your maize have long marks running along them?',
      );
      expect(yes.question, 'Are the marks longer than your finger?');
      expect(no.question, 'Are the lowest leaves yellowing from the tip inwards?');
    });

    test('finishes after eight screens and never names a disease', () {
      final check = MaizeCheck();
      final shown = <String>[];
      while (!check.isDone) {
        shown.add(check.question);
        check.answer(true);
      }
      expect(shown, hasLength(8));
      expect(check.transcript, hasLength(8));
      for (final text in shown) {
        expect(text.toLowerCase(), isNot(matches('spot|blight|virus|disease')));
      }
    });
  });

  group('MaizeCheck outcome', () {
    test('reports streak virus as a wrong flag whatever else was answered', () {
      final check = _run([true, true, true, true, true, true, true, true]);
      expect(check.outcome, CheckOutcome.wrongFlag);
      expect(check.finding, 'maize streak virus');
    });

    test('confirms grey leaf spot from rectangles with grey or tan centres', () {
      final check = _run([true, true, true, true, false, false, false, true]);
      expect(check.outcome, CheckOutcome.confirmed);
      expect(check.finding, 'grey leaf spot');
    });

    test('confirms northern leaf blight from cigar shapes', () {
      final check = _run([true, true, false, true, false, false, false, true]);
      expect(check.outcome, CheckOutcome.confirmed);
      expect(check.finding, 'northern leaf blight');
    });

    test('marks a confirmed blight urgent when worse and above the cob', () {
      final check = _run([true, true, true, true, true, true, false, true]);
      expect(check.outcome, CheckOutcome.confirmedUrgent);
      expect(check.finding, 'grey leaf spot');
    });

    test('reports early signs from tip yellowing without a matched shape', () {
      final check = _run([false, true, false, false, false, false, false, true]);
      expect(check.outcome, CheckOutcome.earlySigns);
    });

    test('reports early signs for stunted plants without stripes', () {
      final check = _run([false, false, false, false, false, false, false, false]);
      expect(check.outcome, CheckOutcome.earlySigns);
    });

    test('reports clear when nothing is found on any branch', () {
      final check = _run([false, false, false, false, false, false, false, true]);
      expect(check.outcome, CheckOutcome.clear);
    });
  });
}
