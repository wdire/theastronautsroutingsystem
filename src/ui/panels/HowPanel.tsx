import type { ReactNode } from 'react';
import { Section } from '@/ui/shell/Section';

function P({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[13px] leading-relaxed text-foreground/90 first:mt-0">{children}</p>;
}
function Limits({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground/80">Limits. </span>
      {children}
    </p>
  );
}

/** How each part is worked out, and where it stops being trustworthy. */
export function HowPanel() {
  return (
    <div>
      <div className="px-4 pt-3 pb-4">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Everything measured here comes from NASA and USGS data. Everything worked out from it is called modelled, and this page says how.
        </p>
      </div>
      <Section id="how-ground" title="The ground" hint="Images and heights, and where they come from">
        <P>
          The picture of the ground is built from three orbiters: Viking for colour over the whole planet, THEMIS on Mars Odyssey and the Context Camera on
          Mars Reconnaissance Orbiter for detail down to about 6 m. Colour comes from Viking; the finer cameras see in black and white, so only their texture
          is used.
        </P>
        <P>
          Heights come from the MOLA laser altimeter, the HRSC and MOLA blended model at 200 m, and the Mars 2020 mission’s own models of Jezero at 20 m and
          1 m. They are joined so there is no step where one takes over.
        </P>
        <Limits>Away from Jezero the finest detail is fetched live from NASA and USGS servers, so it needs a connection. HiRISE covers only strips of the surface.</Limits>
      </Section>
      <Section id="how-relief" title="Relief and light" hint="Why hills look steeper than they are">
        <P>
          Jezero is 45 km wide and about 500 m deep. Drawn to scale it looks flat, so the map stretches heights by up to three times. The chip at the bottom
          of the map always says by how much.
        </P>
        <P>The map is lit as at mid-morning so it always reads. Follow the real sun in the layers panel, or an hour picked on the Mars clock, lights it by the Sun at Jezero instead: long shadows at dawn and dusk, dark at night.</P>
      </Section>
      <Section id="how-routes" title="Routes" hint="How a route is found over real terrain">
        <P>
          A route is searched on a grid of heights, here about 20 m in the crater and 5 m near the rover’s path. The search may cut across cells at any angle,
          so routes are not staircases. Ground steeper than the vehicle can climb is never crossed.
        </P>
        <P>
          Three styles are searched. Safest keeps away from steep, rough and cold ground and from radiation. Fastest only counts time. Eco counts effort: on
          foot that is the energy your body spends, on wheels the battery.
        </P>
        <P>When two styles follow the same ground they are shown as one card.</P>
        <Limits>The grid cannot see a rock or a sand trap smaller than its cells. Perseverance’s real drive detours for hazards a metre across.</Limits>
      </Section>
      <Section id="how-vehicles" title="Vehicles and walking" hint="Speeds and limits">
        <P>
          Walking speed follows Tobler’s hiking rule, capped at 3.3 km/h for a pressurised suit. The effort of walking follows the Pandolf load-carriage
          equation with a 75 kg person in a 45 kg suit, scaled for Mars gravity. Ten degrees uphill costs nearly twice the flat.
        </P>
        <Limits>Nobody has walked on Mars. These are Earth and Apollo figures scaled, and they are estimates.</Limits>
      </Section>
      <Section id="how-budget" title="The trip budget" hint="Time, oxygen, power, water and dose along a route">
        <P>
          The budget walks the route with the clock running. Speed comes from the slope under each stretch. On foot, oxygen follows the effort of walking that
          slope; seated in a rover the crew breathes at rest; work at a stop costs more. A vehicle spends energy to roll and to climb, runs its systems, and
          gains a little from its solar panels, less through dust.
        </P>
        <P>
          A plan works if nothing runs out and it keeps a fifth of the oxygen in reserve. The point of no return is the last place from which the walk home,
          over the same ground the other way, still leaves that reserve.
        </P>
        <P>A plan made with no hour chosen leaves on the first morning the whole trip fits in daylight, half an hour after sunrise.</P>
        <Limits>
          Suit air, scrubber life, battery sizes and water use are planning figures from published NASA studies and from Apollo, not measurements from Mars. Dust on
          the solar panels and the rover resting at night are assumptions.
        </Limits>
      </Section>
      <Section id="how-range" title="Walking range and the walk-home limit" hint="The dashed rings round the start">
        <P>
          The rings show how far two people in suits get on foot in 1, 2 and 4 hours, timed step by step over the real ground. Steep ground pulls a ring in.
        </P>
        <P>
          A crewed rover gets one ring: the furthest point from which its crew could walk home on suit air if the rover failed. Apollo crews drove by the
          same rule.
        </P>
      </Section>
      <Section id="how-mission" title="Running a mission" hint="The simulation, its events and the base">
        <P>
          Start plays the budget back in simulated time: the crew is where the budget says it is at each moment, and has what the budget says it has left. Nobody
          is on Mars; nothing here is telemetry.
        </P>
        <P>
          Events are drawn from a fixed sequence for each plan, so the same plan meets the same dust devil. The app also looks ahead along the route and warns of
          steep ground, the point of no return, sunset and low reserves before the crew reaches them.
        </P>
        <P>
          Alerts come in four levels: note, advisory, caution and warning. A warning holds the mission until it is answered. A new route is drawn on the map with
          what it costs before the crew takes it.
        </P>
        <P>The base answers from the crew’s own numbers by fixed rules. It is not a language model and knows nothing else.</P>
        <Limits>Dust devils, storms and particle events are illustrative: their timing and size are invented, not forecast.</Limits>
      </Section>
      <Section id="how-validate" title="Checked against Perseverance" hint="How close the planner comes to a real drive">
        <P>
          In Discover, the app routes five stretches of Perseverance’s drive between the same two ends and measures how far its line lies from the rover’s: the
          typical distance, and the share of the plan within 300 m.
        </P>
        <Limits>The rover detoured for science and for hazards the size of a wheel. A gap does not always mean the planner is wrong.</Limits>
      </Section>
      <Section id="how-view" title="Rover View" hint="What is real and what is drawn in">
        <P>
          The shape of the ground is the real terrain model, at true scale. Its colour is the orbital image, shifted to the butterscotch tone the rovers'
          cameras record, because orbital colour looks too red from eye level.
        </P>
        <P>Rocks, sand ripples and rock layers smaller than the data are drawn in so the scene has scale. They are illustrative, not measured.</P>
        <P>The sky, the sun’s position and the blue glow at sunset follow the hour and the dust in the air.</P>
      </Section>
      <Section id="how-time" title="Mars time" hint="Sols, seasons and the local clock">
        <P>
          Times are local true solar time at Jezero: noon is when the sun is highest. A sol is 24 h 39 min 35 s. Seasons are given as Ls, the angle of Mars
          around the Sun, where 0 is the start of northern spring. The method is the one NASA’s Mars24 clock uses (Allison and McEwen, 2000).
        </P>
      </Section>
      <Section id="how-weather" title="Temperature, pressure and dust" hint="Modelled conditions">
        <P>Temperature is modelled from latitude, season, hour and height. Pressure starts from 560 Pa at the reference level and falls with height.</P>
        <P>
          Dust is given as optical depth, tau: about 0.4 on a clear day, above 2 in a regional storm, about 5 in a global one. The seasonal curve follows
          what the Mars rovers have recorded. The what-if controls on the clock let you test a plan against a storm.
        </P>
        <Limits>These are climate averages, not a forecast. The weather stations on Curiosity and Perseverance are shown where their feeds answer.</Limits>
      </Section>
      <Section id="how-radiation" title="Radiation" hint="Dose on the surface">
        <P>
          Curiosity’s RAD instrument measures about 0.64 mSv per sol in Gale crater. That figure is scaled here by how much air is overhead: lower ground
          has more air above it and a little less dose. A solar particle event raises it for hours.
        </P>
        <Limits>Dose varies with the solar cycle and with shelter from nearby cliffs, which this model only approximates.</Limits>
      </Section>
      <Section id="how-spaceweather" title="Space weather" hint="Live from NASA, in the Mars clock">
        <P>
          The Sun throws out clouds of charged gas (coronal mass ejections) and bursts of fast particles. NASA models where each cloud will go with
          WSA-ENLIL and lists the results in its DONKI database. The Mars clock reads that list every half hour and tells you when a cloud is due at Mars.
        </P>
        <P>
          Watch means a cloud is forecast at Mars within a week. Warning means within a day, still passing, or that an instrument at Mars recorded
          particles in the last two days.
        </P>
        <Limits>
          Modelled arrival times are good to about half a day. Mars has few instruments, so particle events there are often not recorded at all. If
          NASA does not answer, the clock says so and shows no forecast.
        </Limits>
      </Section>
      <Section id="how-geology" title="Geology and minerals" hint="The geologic map and the CRISM overlays">
        <P>The geologic map is the USGS map of the whole planet (Tanaka and others, 2014). Its units are tens of kilometres across.</P>
        <P>
          The mineral overlays are from CRISM, a spectrometer on Mars Reconnaissance Orbiter that reads minerals from the colours of reflected sunlight.
          Olivine and carbonate around Jezero’s rim are a reason this crater was chosen for Perseverance.
        </P>
      </Section>
    </div>
  );
}
