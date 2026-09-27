#pragma once
#include <vector>
#include <cstdlib>



inline bool chance(int percent)
{
    return (std::rand() % 100) < percent;
}

inline void runChaosEngine(std::vector<satellite*> &sats, 
    std::vector<Debris> &debrisList,int %nextDebrisId,
    std::ofstream &logFile,double simTime){
    if(sats.empty()) 
        return;
    // OOP Unit 2: Pointers to objects
    Satellite *s = sats[std::rand() % sats.size()];

    if (chance(6) && !s->isDisabled()) {
        double sev = 15 + std::rand() % 30;
        s->hitBySolarFlare(sev);
        logFile << "[t=" << simTime << "s] [CHAOS] Solar flare on " << s->getName() << " software -" << sev << "\n";
    }
    if (chance(7) && !s->isDisabled()) {
        double amt = 3 + std::rand() % 8;
        s->hitByBatteryDrain(amt);
    }
    if (chance(2) && !s->isDisabled() && s->isThrusterOk()) {
        s->hitByThrusterFailure();
        logFile << "[t=" << simTime << "s] [CHAOS] Thruster burnout on " << s->getName() << "\n";
    }
}
