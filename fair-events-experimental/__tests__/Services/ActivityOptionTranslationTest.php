<?php
/**
 * ActivityOptionTranslation tests
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEventsExperimental\Services\ActivityOptionTranslation;

/**
 * Covers the fallback behavior available in this process (Polylang absent)
 * and, in separate processes with local `pll_register_string()`/`pll__()`
 * stubs, the actual registration/translation calls.
 */
class ActivityOptionTranslationTest extends TestCase {

	/**
	 * Build an option stub.
	 *
	 * @param int         $id         Option ID.
	 * @param string      $name       Name.
	 * @param string|null $short_name Short name.
	 * @return object
	 */
	private function option( $id, $name, $short_name = null ) {
		$option             = new \stdClass();
		$option->id         = $id;
		$option->name       = $name;
		$option->short_name = $short_name;
		return $option;
	}

	/**
	 * Fallback behavior in the default process (Polylang absent):
	 * translate_name() returns the original value unchanged.
	 */
	public function test_translate_name_returns_original_value_when_polylang_absent() {
		$option = $this->option( 1, 'Yoga class' );

		$this->assertSame( 'Yoga class', ActivityOptionTranslation::translate_name( $option ) );
	}

	/**
	 * Fallback behavior in the default process (Polylang absent):
	 * translate_short_name() returns the original value unchanged.
	 */
	public function test_translate_short_name_returns_original_value_when_polylang_absent() {
		$option = $this->option( 1, 'Yoga class', 'Yoga' );

		$this->assertSame( 'Yoga', ActivityOptionTranslation::translate_short_name( $option ) );
	}

	/**
	 * An option with no short name ever set stays null, not an empty
	 * string.
	 */
	public function test_translate_short_name_returns_null_when_never_set() {
		$option = $this->option( 1, 'Yoga class' );

		$this->assertNull( ActivityOptionTranslation::translate_short_name( $option ) );
	}

	/**
	 * Fallback behavior in the default process (Polylang absent):
	 * register() is a no-op.
	 */
	public function test_register_is_a_no_op_when_polylang_absent() {
		// No pll_register_string() defined in this process — calling
		// register() must simply not fatal or throw.
		$option = $this->option( 1, 'Yoga class', 'Yoga' );

		ActivityOptionTranslation::register( $option );

		$this->addToAssertionCount( 1 );
	}

	/**
	 * Registration and translation both go through Polylang when it's
	 * present. Defines local `pll_register_string()`/`pll__()` stubs that
	 * record calls, so this must run isolated from the rest of the suite.
	 *
	 * @runInSeparateProcess
	 */
	public function test_register_calls_pll_register_string_with_stable_name_and_group() {
		require_once __DIR__ . '/../helpers/pll-stubs.php';

		$option = $this->option( 42, 'Yoga class', 'Yoga' );

		ActivityOptionTranslation::register( $option );

		$calls = $GLOBALS['_fair_pll_registered_strings'];

		$this->assertSame(
			array(
				'name'   => 'Yoga class',
				'group'  => ActivityOptionTranslation::GROUP,
				'string' => 'fair_events_ticket_option_42_name',
			),
			array(
				'name'   => $calls['fair_events_ticket_option_42_name']['string'],
				'group'  => $calls['fair_events_ticket_option_42_name']['group'],
				'string' => 'fair_events_ticket_option_42_name',
			)
		);
		$this->assertArrayHasKey( 'fair_events_ticket_option_42_short_name', $calls );
	}

	/**
	 * An empty short_name is never registered.
	 *
	 * @runInSeparateProcess
	 */
	public function test_register_does_not_register_empty_short_name() {
		require_once __DIR__ . '/../helpers/pll-stubs.php';

		$option = $this->option( 7, 'Yoga class' );

		ActivityOptionTranslation::register( $option );

		$calls = $GLOBALS['_fair_pll_registered_strings'];

		$this->assertArrayHasKey( 'fair_events_ticket_option_7_name', $calls );
		$this->assertArrayNotHasKey( 'fair_events_ticket_option_7_short_name', $calls );
	}

	/**
	 * A changed value re-registers under the same stable string name,
	 * rather than a new one.
	 *
	 * @runInSeparateProcess
	 */
	public function test_register_reuses_the_same_string_name_when_value_changes() {
		require_once __DIR__ . '/../helpers/pll-stubs.php';

		ActivityOptionTranslation::register( $this->option( 3, 'Yoga class' ) );
		ActivityOptionTranslation::register( $this->option( 3, 'Yoga class (updated)' ) );

		$calls = $GLOBALS['_fair_pll_registered_strings'];

		$this->assertCount( 1, $calls );
		$this->assertSame( 'Yoga class (updated)', $calls['fair_events_ticket_option_3_name']['string'] );
	}

	/**
	 * `translate_name()` resolves through `pll__()` when Polylang is
	 * present.
	 *
	 * @runInSeparateProcess
	 */
	public function test_translate_name_resolves_through_pll() {
		require_once __DIR__ . '/../helpers/pll-stubs.php';

		$GLOBALS['_fair_pll_translations']['Yoga class'] = 'Clase de yoga';

		$result = ActivityOptionTranslation::translate_name( $this->option( 1, 'Yoga class' ) );

		$this->assertSame( 'Clase de yoga', $result );
	}

	/**
	 * An option literally named "0" is a real value, not a blank one —
	 * `empty( '0' )` is true in PHP, so a naive empty() check would wrongly
	 * skip it. translate_name() must still return it unchanged in this
	 * process (Polylang absent).
	 */
	public function test_translate_name_treats_the_string_zero_as_a_real_value() {
		$option = $this->option( 1, '0' );

		$this->assertSame( '0', ActivityOptionTranslation::translate_name( $option ) );
	}

	/**
	 * Same "0" pitfall for short_name.
	 */
	public function test_translate_short_name_treats_the_string_zero_as_a_real_value() {
		$option = $this->option( 1, 'Yoga class', '0' );

		$this->assertSame( '0', ActivityOptionTranslation::translate_short_name( $option ) );
	}

	/**
	 * Register() must register a name/short_name of "0" — it's a real
	 * value, not an empty one.
	 *
	 * @runInSeparateProcess
	 */
	public function test_register_registers_the_string_zero_as_a_real_value() {
		require_once __DIR__ . '/../helpers/pll-stubs.php';

		$option = $this->option( 9, '0', '0' );

		ActivityOptionTranslation::register( $option );

		$calls = $GLOBALS['_fair_pll_registered_strings'];

		$this->assertSame( '0', $calls['fair_events_ticket_option_9_name']['string'] );
		$this->assertSame( '0', $calls['fair_events_ticket_option_9_short_name']['string'] );
	}
}
