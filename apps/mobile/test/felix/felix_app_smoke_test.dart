import 'package:almanac/features/felix/felix_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(seconds: 1));
}

Future<void> _openTab(WidgetTester tester, String label) async {
  await tester.tap(find.text(label).last);
  await _settle(tester);
}

Future<void> _reply(WidgetTester tester, String option) async {
  await tester.tap(find.text(option));
  await _settle(tester);
}

void main() {
  testWidgets('sends check-ins to high-risk farms and moves an urgent maize '
      'answer to the top of the plan', (tester) async {
    await tester.pumpWidget(const FelixApp());
    await _settle(tester);

    expect(find.text('Check-in sent'), findsWidgets);

    await _openTab(tester, 'Profile');
    expect(find.text('Automatic USSD check-ins'), findsOneWidget);
    await tester.tap(find.text('Farmer check-in'));
    await _settle(tester);
    await tester.tap(find.text('Mphatso Fields').last);
    await _settle(tester);

    expect(find.text('What are you growing?'), findsOneWidget);
    await _reply(tester, '1. Maize');
    // Long rectangular marks, grey centres, worse and above the cob, no stripes.
    for (final option in [
      '1. Yes', '1. Yes', '1. Yes', '1. Yes', //
      '1. Yes', '1. Yes', '2. No', '1. Yes',
    ]) {
      await _reply(tester, option);
    }
    expect(find.textContaining('sent to your field officer'), findsOneWidget);
    await _reply(tester, 'OK');

    await _openTab(tester, 'Insights');
    expect(find.text('Caught early'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('Mphatso Fields').first).dy,
      lessThan(tester.getTopLeft(find.text('Chimwemwe Farm').first).dy),
    );
    expect(find.textContaining('grey leaf spot'), findsWidgets);
  });

  testWidgets('a non-maize crop is marked for a call', (tester) async {
    await tester.pumpWidget(const FelixApp());
    await _settle(tester);

    await _openTab(tester, 'Profile');
    await tester.tap(find.text('Farmer check-in'));
    await _settle(tester);
    await tester.tap(find.text('Kasungu North').last);
    await _settle(tester);
    await _reply(tester, '2. Beans');

    expect(find.textContaining('sent to your field officer'), findsOneWidget);
    await _reply(tester, 'OK');
    expect(find.textContaining('Kasungu North: Call today'), findsOneWidget);
  });

  testWidgets('turning consent off withdraws unanswered check-ins', (
    tester,
  ) async {
    await tester.pumpWidget(const FelixApp());
    await _settle(tester);

    await _openTab(tester, 'Profile');
    await tester.tap(find.byType(Switch));
    await _settle(tester);
    await _openTab(tester, 'Home');

    expect(find.text('Check-in sent'), findsNothing);
    expect(find.text('Call farmer'), findsWidgets);
  });
}
