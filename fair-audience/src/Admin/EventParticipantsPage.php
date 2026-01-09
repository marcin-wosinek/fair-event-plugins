<?php
/**
 * Event Participants Page
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Event Participants admin page (hidden from menu).
 */
class EventParticipantsPage {
	/**
	 * Render page.
	 */
	public function render() {
		?>
		<div id="fair-audience-event-participants-root"></div>
		<?php
	}
}
