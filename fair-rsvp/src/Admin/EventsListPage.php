<?php
/**
 * Events List page for Fair RSVP
 *
 * @package FairRsvp
 */

namespace FairRsvp\Admin;

defined( 'WPINC' ) || die;

/**
 * Events List Page class for managing event RSVPs
 */
class EventsListPage {

	/**
	 * Render the events list page
	 *
	 * @return void
	 */
	public function render() {
		?>
		<div id="fair-rsvp-events-root"></div>
		<?php
	}
}
