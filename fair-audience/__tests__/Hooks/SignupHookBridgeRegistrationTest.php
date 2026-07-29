<?php
/**
 * SignupHookBridge registration contract test.
 *
 * Guards against the class of bug fixed in #1310: a hook registered with
 * `accepted_args` lower than what the callback requires makes WordPress call
 * it with too few arguments, throwing ArgumentCountError on every signup.
 * For each registration this asserts:
 *   callback's required params <= registered accepted_args <= what
 *   fair-events' GetTicketsController/render.php actually passes.
 * The "actually passes" counts are a hardcoded map mirroring the audit table
 * in REST_API_BACKEND.md — update both together when either side changes.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Hooks;

use PHPUnit\Framework\TestCase;
use FairAudience\Hooks\SignupHookBridge;
use ReflectionMethod;

/**
 * Unit tests for SignupHookBridge's hook registrations.
 */
class SignupHookBridgeRegistrationTest extends TestCase {

	/**
	 * Number of arguments fair-events actually passes to each signup
	 * extension point, per the audit in REST_API_BACKEND.md.
	 *
	 * @var array<string, int>
	 */
	private const ARGS_PASSED_BY_FAIR_EVENTS = array(
		'fair_events_signup_render_context'           => 3,
		'fair_events_signup_render_before_submit'     => 1,
		'fair_events_signup_render_after_form'        => 1,
		'fair_events_signup_ticket_type_error'        => 3,
		'fair_events_signup_unit_price'               => 3,
		'fair_events_signup_options_error'            => 4,
		'fair_events_signup_option_line_items'        => 3,
		'fair_events_signup_created'                  => 6,
		'fair_events_signup_confirmed'                => 2,
		'fair_events_signup_payment_failed'           => 2,
		'fair_events_backfill_signup_participant_ids' => 0,
	);

	/**
	 * Reset recorded hook registrations before each test.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_hooks'] = array();
	}

	/**
	 * Every registration's accepted_args must sit between the callback's
	 * required-parameter count and the number of arguments fair-events
	 * actually passes on that hook.
	 */
	public function test_every_registration_accepts_the_arguments_it_needs_and_receives() {
		SignupHookBridge::init();

		$this->assertNotEmpty( $GLOBALS['_fair_test_hooks'], 'SignupHookBridge::init() should register at least one hook.' );

		foreach ( $GLOBALS['_fair_test_hooks'] as $hook_name => $registrations ) {
			$this->assertArrayHasKey(
				$hook_name,
				self::ARGS_PASSED_BY_FAIR_EVENTS,
				"Hook '{$hook_name}' is registered but missing from the fair-events audit map — add it to REST_API_BACKEND.md and this test."
			);

			$args_passed = self::ARGS_PASSED_BY_FAIR_EVENTS[ $hook_name ];

			foreach ( $registrations as $registration ) {
				list( $class, $method ) = $registration['callback'];
				$reflection             = new ReflectionMethod( $class, $method );
				$required_params        = $reflection->getNumberOfRequiredParameters();
				$accepted_args          = $registration['accepted_args'];

				$this->assertLessThanOrEqual(
					$accepted_args,
					$required_params,
					"{$class}::{$method}() requires {$required_params} args but '{$hook_name}' is registered with accepted_args={$accepted_args} — WordPress will throw ArgumentCountError."
				);

				// Skipped when fair-events passes zero args: WP always slices
				// the args array to min( accepted_args, actual count ), so an
				// inflated accepted_args is inert when there's nothing to slice.
				if ( $args_passed > 0 ) {
					$this->assertLessThanOrEqual(
						$args_passed,
						$accepted_args,
						"'{$hook_name}' is registered with accepted_args={$accepted_args} but fair-events only passes {$args_passed} — extra args will always be null."
					);
				}
			}
		}
	}
}
